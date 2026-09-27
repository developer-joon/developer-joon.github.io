-- Rewrite public post attachment references without exposing private Storage paths.

begin;

alter table public.posts drop constraint posts_body_length_check;
alter table public.posts add constraint posts_body_length_check check (
  pg_catalog.char_length(pg_catalog.btrim(body_markdown)) between 1 and 50000
  and pg_catalog.char_length(body_markdown) <= 50000
);

-- Scan one bounded UTF-8 byte string while copying untouched spans exactly.
-- The mapping arrays are capped by the wrapper; this helper reads no relation.
create or replace function private.scan_public_post_body(
  p_body text,
  p_attachment_ids uuid[],
  p_storage_paths text[]
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  unavailable constant text := 'about:blank#attachment-unavailable';
  src bytea;
  result bytea := ''::bytea;
  n integer;
  i integer := 0;
  copy_at integer := 0;
  j integer;
  k integer;
  span_end integer;
  core_end integer;
  replace_at integer;
  quote_end integer := -1;
  nesting integer := 0;
  transformations integer := 0;
  c integer;
  previous integer;
  escaped boolean;
  strip_angle boolean;
  candidate text;
  core text;
  lowered text;
  uri_path text;
  path_value text;
  key_name text;
  replacement text;
  mapped_id uuid;
  item integer;
begin
  if p_body is null then
    return null;
  end if;
  if pg_catalog.char_length(p_body)>50000 then
    raise exception 'public post body capacity exceeded' using errcode='54000';
  end if;
  if coalesce(pg_catalog.cardinality(p_attachment_ids),0)>5
     or coalesce(pg_catalog.cardinality(p_storage_paths),0)>5
     or coalesce(pg_catalog.cardinality(p_attachment_ids),0)<>
        coalesce(pg_catalog.cardinality(p_storage_paths),0) then
    raise exception 'public post attachment capacity exceeded' using errcode='54000';
  end if;

  src := pg_catalog.convert_to(p_body,'UTF8');
  n := pg_catalog.length(src);
  while i<n loop
    c := pg_catalog.get_byte(src,i);
    previous := case when i=0 then null else pg_catalog.get_byte(src,i-1) end;

    if quote_end>=0 then
      if i=quote_end then
        quote_end := -1;
        i := i+1;
        continue;
      elsif i>quote_end then
        quote_end := -1;
      end if;
    end if;

    -- Any unescaped quote establishes a one-line lexical span, independent of
    -- preceding punctuation. Backslash parity distinguishes escaped quotes.
    if c in (34,39) and quote_end<0 then
      k := i;
      escaped := false;
      while k>0 and pg_catalog.get_byte(src,k-1)=92 loop
        escaped := not escaped;
        k := k-1;
      end loop;
      if not escaped then
        j := i+1;
        escaped := false;
        while j<n loop
          if pg_catalog.get_byte(src,j) in (10,13) then
            exit;
          elsif escaped then
            escaped := false;
          elsif pg_catalog.get_byte(src,j)=92 then
            escaped := true;
          elsif pg_catalog.get_byte(src,j)=c then
            j := j+1;
            exit;
          end if;
          j := j+1;
        end loop;
        candidate := pg_catalog.convert_from(pg_catalog.substr(src,i+1,j-i),'UTF8');
        if candidate ~* '(^|[^[:alnum:]_-])(token|api[_-]?key|signature|signed|secret|service[_-]?role|x-amz-(credential|signature))[[:space:]]*='
           or candidate ~* '(^|[^[:alnum:]_-])sb_secret_[[:alnum:]_-]+($|[^[:alnum:]_-])' then
          replace_at := i;
          replacement := unavailable;
          if i>copy_at and previous in (9,32) and j<n and pg_catalog.get_byte(src,j)=41 then
            replace_at := i-1;
            replacement := '';
          end if;
          transformations := transformations+1;
          if transformations>256 then
            raise exception 'public post body transformation capacity exceeded' using errcode='54000';
          end if;
          result := result||pg_catalog.substr(src,copy_at+1,replace_at-copy_at)
                   ||pg_catalog.convert_to(replacement,'UTF8');
          i := j;
          copy_at := j;
          continue;
        end if;
        if j>i+1 and pg_catalog.get_byte(src,j-1)=c then
          quote_end := j-1;
        end if;
        i := i+1;
        continue;
      end if;
    end if;

    -- Absolute URI recognition precedes every standalone-path rule. Only a
    -- managed endpoint or credential can change an otherwise ordinary URI.
    if (c between 65 and 90 or c between 97 and 122)
       and (previous is null or not (
         previous between 48 and 57 or previous between 65 and 90 or
         previous between 97 and 122 or previous in (43,45,46)
       )) then
      j := i+1;
      while j<n and (
        pg_catalog.get_byte(src,j) between 48 and 57 or
        pg_catalog.get_byte(src,j) between 65 and 90 or
        pg_catalog.get_byte(src,j) between 97 and 122 or
        pg_catalog.get_byte(src,j) in (43,45,46)
      ) loop
        j := j+1;
      end loop;
      if j<n and pg_catalog.get_byte(src,j)=58 then
          span_end := j+1;
          while span_end<n and pg_catalog.get_byte(src,span_end)>32
            and pg_catalog.get_byte(src,span_end) not in (34,39,60,62) loop
            span_end := span_end+1;
          end loop;
          core_end := span_end;
          while core_end>j+1 and pg_catalog.get_byte(src,core_end-1) in (33,35,41,44,46,59,63,91,93) loop
            core_end := core_end-1;
          end loop;
          candidate := pg_catalog.convert_from(pg_catalog.substr(src,i+1,span_end-i),'UTF8');
          core := pg_catalog.convert_from(pg_catalog.substr(src,i+1,core_end-i),'UTF8');
          lowered := pg_catalog.lower(core);
          replacement := null;
          uri_path := null;
          if j+2<n and pg_catalog.get_byte(src,j+1)=47 and pg_catalog.get_byte(src,j+2)=47 then
            k := pg_catalog.strpos(pg_catalog.substr(lowered,j-i+4),'/');
            if k>0 then
              uri_path := pg_catalog.substr(core,j-i+3+k);
            end if;
          else
            uri_path := pg_catalog.substr(core,j-i+2);
          end if;
          if uri_path is not null then
            lowered := pg_catalog.lower(uri_path);
            if lowered ~ '^/?storage/v1/object/' then
              path_value:=pg_catalog.regexp_replace(uri_path,'^/?storage/v1/object/','','i');
              if pg_catalog.starts_with(pg_catalog.lower(path_value),'public/') then path_value:=pg_catalog.substr(path_value,8);
              elsif pg_catalog.starts_with(pg_catalog.lower(path_value),'sign/') then path_value:=pg_catalog.substr(path_value,6);
              elsif pg_catalog.starts_with(pg_catalog.lower(path_value),'authenticated/') then path_value:=pg_catalog.substr(path_value,15);
              end if;
              if pg_catalog.starts_with(pg_catalog.lower(path_value),'community-images/') then
                path_value:=pg_catalog.substr(path_value,18);
                path_value:=pg_catalog.split_part(pg_catalog.split_part(path_value,'?',1),'#',1);
                mapped_id:=null;
                for item in 1..coalesce(pg_catalog.cardinality(p_storage_paths),0) loop
                  if path_value collate "C"=p_storage_paths[item] collate "C" then mapped_id:=p_attachment_ids[item]; exit; end if;
                end loop;
                replacement:=coalesce('/functions/v1/public-attachment/'||mapped_id::text,unavailable);
              else replacement:=unavailable;
              end if;
            elsif lowered ~ '^/?community-images/' then
              path_value:=pg_catalog.regexp_replace(uri_path,'^/?community-images/','','i');
              path_value:=pg_catalog.split_part(pg_catalog.split_part(path_value,'?',1),'#',1);
              mapped_id:=null;
              for item in 1..coalesce(pg_catalog.cardinality(p_storage_paths),0) loop
                if path_value collate "C"=p_storage_paths[item] collate "C" then mapped_id:=p_attachment_ids[item]; exit; end if;
              end loop;
              replacement:=coalesce('/functions/v1/public-attachment/'||mapped_id::text,unavailable);
            elsif lowered ~ '^/?functions/v1/public-attachment/' then
              path_value:=pg_catalog.regexp_replace(uri_path,'^/?functions/v1/public-attachment/','','i');
              path_value:=pg_catalog.split_part(pg_catalog.split_part(path_value,'?',1),'#',1);
              mapped_id:=null;
              for item in 1..coalesce(pg_catalog.cardinality(p_attachment_ids),0) loop
                if pg_catalog.lower(path_value)=p_attachment_ids[item]::text then mapped_id:=p_attachment_ids[item]; exit; end if;
              end loop;
              replacement:=coalesce('/functions/v1/public-attachment/'||mapped_id::text,unavailable);
            end if;
          end if;
          if replacement is null and (
               candidate ~* '(^|[^[:alnum:]_-])(token|api[_-]?key|signature|signed|secret|service[_-]?role|x-amz-(credential|signature))[[:space:]]*='
               or candidate ~* '(^|[^[:alnum:]_-])sb_secret_[[:alnum:]_-]+($|[^[:alnum:]_-])'
             ) then
            replacement := unavailable;
          end if;
          if replacement is not null then
            strip_angle:=i>=3 and previous=60
              and pg_catalog.get_byte(src,i-2)=40 and pg_catalog.get_byte(src,i-3)=93;
            replace_at:=case when strip_angle then i-1 else i end;
            transformations := transformations+1;
            if transformations>256 then
              raise exception 'public post body transformation capacity exceeded' using errcode='54000';
            end if;
            result:=result||pg_catalog.substr(src,copy_at+1,replace_at-copy_at)
                   ||pg_catalog.convert_to(replacement,'UTF8')
                   ||pg_catalog.substr(src,core_end+1,span_end-core_end);
            if strip_angle and span_end<n and pg_catalog.get_byte(src,span_end)=62 then
              span_end:=span_end+1;
            end if;
            i:=span_end;
            copy_at:=span_end;
          else
            i:=span_end;
          end if;
          k:=core_end;
          while k<span_end loop
            c:=pg_catalog.get_byte(src,k);
            if c in (40,91,123) then
              nesting:=nesting+1;
              if nesting>32 then return unavailable; end if;
            elsif c in (41,93,125) and nesting>0 then
              nesting:=nesting-1;
            end if;
            k:=k+1;
          end loop;
          continue;
      end if;
    end if;

    -- Managed route candidates are bounded by Markdown/token delimiters. Their
    -- query and fragment are intentionally discarded; bare ?/# remain syntax.
    candidate := null;
    if (previous is null or not (
         previous between 48 and 57 or previous between 65 and 90 or
         previous between 97 and 122 or previous in (45,95)
       )) and (
       pg_catalog.substr(src,i+1,19)=pg_catalog.convert_to('/storage/v1/object/','UTF8')
       or pg_catalog.substr(src,i+1,18)=pg_catalog.convert_to('storage/v1/object/','UTF8')
       or pg_catalog.substr(src,i+1,32)=pg_catalog.convert_to('/functions/v1/public-attachment/','UTF8')
       or pg_catalog.substr(src,i+1,31)=pg_catalog.convert_to('functions/v1/public-attachment/','UTF8')
       or pg_catalog.substr(src,i+1,17)=pg_catalog.convert_to('community-images/','UTF8')) then
      span_end:=i;
      while span_end<n and pg_catalog.get_byte(src,span_end)>32
        and pg_catalog.get_byte(src,span_end) not in (34,39,60,62) loop
        span_end:=span_end+1;
      end loop;
      core_end:=span_end;
      while core_end>i and pg_catalog.get_byte(src,core_end-1) in (33,35,41,44,46,58,59,61,63,91,93) loop core_end:=core_end-1; end loop;
      core:=pg_catalog.convert_from(pg_catalog.substr(src,i+1,core_end-i),'UTF8');
      lowered:=pg_catalog.lower(core);
      path_value:=null;
      if lowered ~ '^/?storage/v1/object/' then
        path_value:=pg_catalog.regexp_replace(core,'^/?storage/v1/object/','','i');
        path_value:=pg_catalog.regexp_replace(path_value,'^(public|sign|authenticated)/','','i');
        if pg_catalog.starts_with(pg_catalog.lower(path_value),'community-images/') then path_value:=pg_catalog.substr(path_value,18); end if;
      elsif pg_catalog.starts_with(lowered,'community-images/') then
        path_value:=pg_catalog.substr(core,18);
      end if;
      mapped_id:=null;
      if path_value is not null then
        path_value:=pg_catalog.split_part(pg_catalog.split_part(path_value,'?',1),'#',1);
        for item in 1..coalesce(pg_catalog.cardinality(p_storage_paths),0) loop
          if path_value collate "C"=p_storage_paths[item] collate "C" then mapped_id:=p_attachment_ids[item]; exit; end if;
        end loop;
      elsif lowered ~ '^/?functions/v1/public-attachment/' then
        path_value:=pg_catalog.regexp_replace(core,'^/?functions/v1/public-attachment/','','i');
        path_value:=pg_catalog.split_part(pg_catalog.split_part(path_value,'?',1),'#',1);
        for item in 1..coalesce(pg_catalog.cardinality(p_attachment_ids),0) loop
          if pg_catalog.lower(path_value)=p_attachment_ids[item]::text then mapped_id:=p_attachment_ids[item]; exit; end if;
        end loop;
      end if;
      replacement:=coalesce('/functions/v1/public-attachment/'||mapped_id::text,unavailable);
      strip_angle:=i>=3 and previous=60
        and pg_catalog.get_byte(src,i-2)=40 and pg_catalog.get_byte(src,i-3)=93;
      replace_at:=case when strip_angle then i-1 else i end;
      transformations := transformations+1;
      if transformations>256 then
        raise exception 'public post body transformation capacity exceeded' using errcode='54000';
      end if;
      result:=result||pg_catalog.substr(src,copy_at+1,replace_at-copy_at)
             ||pg_catalog.convert_to(replacement,'UTF8')
             ||pg_catalog.substr(src,core_end+1,span_end-core_end);
      if strip_angle and span_end<n and pg_catalog.get_byte(src,span_end)=62 then
        span_end:=span_end+1;
      end if;
      k:=core_end;
      while k<span_end loop
        c:=pg_catalog.get_byte(src,k);
        if c in (40,91,123) then
          nesting:=nesting+1;
          if nesting>32 then return unavailable; end if;
        elsif c in (41,93,125) and nesting>0 then
          nesting:=nesting-1;
        end if;
        k:=k+1;
      end loop;
      i:=span_end;
      copy_at:=span_end;
      continue;
    end if;

    -- A UUID/UUID pair is sensitive only when it is a standalone token.
    if i+73<=n
       and (c between 48 and 57 or c between 65 and 70 or c between 97 and 102)
       and (previous is null or not (
         previous between 48 and 57 or previous between 65 and 90 or
         previous between 97 and 122 or previous in (45,95)
       ))
       and not (
         i>=18
         and pg_catalog.substr(src,i-16,17)=pg_catalog.convert_to('community-images/','UTF8')
         and (
           pg_catalog.get_byte(src,i-18) between 48 and 57 or
           pg_catalog.get_byte(src,i-18) between 65 and 90 or
           pg_catalog.get_byte(src,i-18) between 97 and 122 or
           pg_catalog.get_byte(src,i-18) in (45,95)
         )
       ) then
      j:=i;
      while j<i+73 and (
        pg_catalog.get_byte(src,j) between 48 and 57 or
        pg_catalog.get_byte(src,j) between 65 and 70 or
        pg_catalog.get_byte(src,j) between 97 and 102 or
        pg_catalog.get_byte(src,j) in (45,47)
      ) loop j:=j+1; end loop;
      if j=i+73 then
        candidate:=pg_catalog.convert_from(pg_catalog.substr(src,i+1,73),'UTF8');
      end if;
      if j=i+73
         and candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and (i+73=n or not (
           pg_catalog.get_byte(src,i+73) between 48 and 57 or pg_catalog.get_byte(src,i+73) between 65 and 90 or
           pg_catalog.get_byte(src,i+73) between 97 and 122 or pg_catalog.get_byte(src,i+73) in (45,95)
         )) then
        span_end:=i+73;
        if span_end<n and pg_catalog.get_byte(src,span_end) in (35,63)
           and span_end+1<n and pg_catalog.get_byte(src,span_end+1)>32
           and pg_catalog.get_byte(src,span_end+1) not in (34,39,41,60,62) then
          span_end:=span_end+1;
          while span_end<n and pg_catalog.get_byte(src,span_end)>32
            and pg_catalog.get_byte(src,span_end) not in (34,39,41,60,62) loop span_end:=span_end+1; end loop;
        end if;
        mapped_id:=null;
        for item in 1..coalesce(pg_catalog.cardinality(p_storage_paths),0) loop
          if pg_catalog.lower(candidate)=p_storage_paths[item] then mapped_id:=p_attachment_ids[item]; exit; end if;
        end loop;
        replacement:=coalesce('/functions/v1/public-attachment/'||mapped_id::text,unavailable);
        strip_angle:=i>=3 and previous=60
          and pg_catalog.get_byte(src,i-2)=40 and pg_catalog.get_byte(src,i-3)=93;
        replace_at:=case when strip_angle then i-1 else i end;
        transformations := transformations+1;
        if transformations>256 then
          raise exception 'public post body transformation capacity exceeded' using errcode='54000';
        end if;
        result:=result||pg_catalog.substr(src,copy_at+1,replace_at-copy_at)||pg_catalog.convert_to(replacement,'UTF8');
        if strip_angle and span_end<n and pg_catalog.get_byte(src,span_end)=62 then
          span_end:=span_end+1;
        end if;
        i:=span_end;
        copy_at:=span_end;
        continue;
      end if;
    end if;

    -- Standalone assignments consume one escaped or unescaped value token.
    if (c between 65 and 90 or c between 97 and 122)
       and (previous is null or not (previous between 48 and 57 or previous between 65 and 90 or previous between 97 and 122 or previous in (45,95))) then
      j:=i+1;
      while j<n and (pg_catalog.get_byte(src,j) between 48 and 57 or pg_catalog.get_byte(src,j) between 65 and 90 or pg_catalog.get_byte(src,j) between 97 and 122 or pg_catalog.get_byte(src,j) in (45,95)) loop j:=j+1; end loop;
      key_name:=pg_catalog.lower(pg_catalog.convert_from(pg_catalog.substr(src,i+1,j-i),'UTF8'));
      k:=j;
      while k<n and pg_catalog.get_byte(src,k) in (9,32) loop k:=k+1; end loop;
      if key_name in ('token','apikey','api-key','api_key','signature','signed','secret','service-role','service_role','x-amz-credential','x-amz-signature')
         and k<n and pg_catalog.get_byte(src,k)=61 then
        span_end:=k+1;
        if span_end<n and pg_catalog.get_byte(src,span_end) in (34,39) then
          c:=pg_catalog.get_byte(src,span_end);
          span_end:=span_end+1;
          escaped:=false;
          while span_end<n loop
            if pg_catalog.get_byte(src,span_end) in (10,13) then exit;
            elsif escaped then escaped:=false;
            elsif pg_catalog.get_byte(src,span_end)=92 then escaped:=true;
            elsif pg_catalog.get_byte(src,span_end)=c then span_end:=span_end+1; exit;
            end if;
            span_end:=span_end+1;
          end loop;
          core_end:=span_end;
        else
          escaped:=false;
          while span_end<n loop
            c:=pg_catalog.get_byte(src,span_end);
            if escaped then escaped:=false;
            elsif c=92 then escaped:=true;
            elsif c<=32 or c in (34,39,41,60,62) then exit;
            end if;
            span_end:=span_end+1;
          end loop;
          core_end:=span_end;
          while core_end>k+1 and pg_catalog.get_byte(src,core_end-1) in (33,44,46,59,63,91,93) loop core_end:=core_end-1; end loop;
        end if;
        transformations := transformations+1;
        if transformations>256 then
          raise exception 'public post body transformation capacity exceeded' using errcode='54000';
        end if;
        result:=result||pg_catalog.substr(src,copy_at+1,i-copy_at)||pg_catalog.convert_to(unavailable,'UTF8')
               ||pg_catalog.substr(src,core_end+1,span_end-core_end);
        i:=span_end;
        copy_at:=span_end;
        continue;
      end if;
    end if;

    if i+10<=n
       and pg_catalog.get_byte(src,i) in (83,115)
       and pg_catalog.get_byte(src,i+1) in (66,98)
       and pg_catalog.get_byte(src,i+2)=95
       and pg_catalog.get_byte(src,i+3) in (83,115)
       and pg_catalog.get_byte(src,i+4) in (69,101)
       and pg_catalog.get_byte(src,i+5) in (67,99)
       and pg_catalog.get_byte(src,i+6) in (82,114)
       and pg_catalog.get_byte(src,i+7) in (69,101)
       and pg_catalog.get_byte(src,i+8) in (84,116)
       and pg_catalog.get_byte(src,i+9)=95
       and (previous is null or not (previous between 48 and 57 or previous between 65 and 90 or previous between 97 and 122 or previous in (45,95))) then
      span_end:=i+10;
      while span_end<n and (pg_catalog.get_byte(src,span_end) between 48 and 57 or pg_catalog.get_byte(src,span_end) between 65 and 90 or pg_catalog.get_byte(src,span_end) between 97 and 122 or pg_catalog.get_byte(src,span_end) in (45,95)) loop span_end:=span_end+1; end loop;
      if span_end>i+10 and (span_end=n or not (pg_catalog.get_byte(src,span_end) between 48 and 57 or pg_catalog.get_byte(src,span_end) between 65 and 90 or pg_catalog.get_byte(src,span_end) between 97 and 122 or pg_catalog.get_byte(src,span_end) in (45,95))) then
        transformations := transformations+1;
        if transformations>256 then
          raise exception 'public post body transformation capacity exceeded' using errcode='54000';
        end if;
        result:=result||pg_catalog.substr(src,copy_at+1,i-copy_at)||pg_catalog.convert_to(unavailable,'UTF8');
        i:=span_end;
        copy_at:=span_end;
        continue;
      end if;
    end if;

    if c in (40,91,123) then
      nesting:=nesting+1;
      if nesting>32 then return unavailable; end if;
    elsif c in (41,93,125) and nesting>0 then
      nesting:=nesting-1;
    end if;
    i:=i+1;
  end loop;
  result:=result||pg_catalog.substr(src,copy_at+1);
  return pg_catalog.convert_from(result,'UTF8');
end;
$$;

create or replace function private.public_post_body(
  p_post_id uuid,
  p_body_markdown text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  attachment_ids uuid[];
  storage_paths text[];
begin
  if p_body_markdown is null then return null; end if;
  if pg_catalog.char_length(p_body_markdown)>50000 then
    raise exception 'public post body capacity exceeded' using errcode='54000';
  end if;
  select coalesce(pg_catalog.array_agg(a.id order by a.id),array[]::uuid[]),
         coalesce(pg_catalog.array_agg(a.storage_path order by a.id),array[]::text[])
    into attachment_ids,storage_paths
    from (
      select x.id,x.storage_path
        from public.attachments x
       where x.post_id=p_post_id and x.status='attached' and x.deleted_at is null
         and x.client_key is not null and x.payload_sha256 is not null
         and x.storage_path collate "C"=(x.owner_id::text||'/'||x.client_key::text) collate "C"
       order by x.id
       limit 6
    ) a;
  if pg_catalog.cardinality(attachment_ids)>5 then
    raise exception 'public post attachment capacity exceeded' using errcode='54000';
  end if;
  return private.scan_public_post_body(p_body_markdown,attachment_ids,storage_paths);
end;
$$;

drop function if exists private.public_attachment_destination(uuid,text,text);

create or replace function private.public_post_excerpt(p_post_id uuid,p_body_markdown text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bounded_body text;
begin
  if p_body_markdown is null then
    return null;
  end if;
  bounded_body := pg_catalog.left(p_body_markdown,2048);
  if pg_catalog.char_length(p_body_markdown)>2048 and bounded_body !~ '[[:space:]]$' then
    bounded_body := pg_catalog.regexp_replace(bounded_body,'[^[:space:]]*$','','n');
  end if;
  return pg_catalog.left(private.public_post_body(p_post_id,bounded_body),180);
end;
$$;

create or replace function public.get_public_post(p_post_id uuid)
returns table(
  id uuid,
  title text,
  body_markdown text,
  created_at timestamptz,
  updated_at timestamptz,
  is_locked boolean,
  is_pinned boolean,
  author_id uuid,
  author_login text,
  author_display_name text,
  author_avatar_url text,
  tags jsonb,
  comment_count bigint,
  reaction_count bigint,
  popularity_score bigint
)
language sql stable security definer set search_path='' as $$
  select p.id,p.title,private.public_post_body(p.id,p.body_markdown),
    p.created_at,p.updated_at,p.is_locked,p.is_pinned,
    pr.id,pr.login,pr.display_name,pr.avatar_url,
    coalesce(t.tags,'[]'::jsonb),c.comment_count,c.reaction_count,c.popularity_score
  from public.posts p
  join public.profiles pr on pr.id=p.author_id
  cross join lateral private.public_post_counts(p.id) c
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('id',tag.id,'slug',tag.slug,'label',tag.label)
      order by tag.sort_order,tag.label,tag.id
    ) tags
    from public.post_tags pt
    join public.tags tag on tag.id=pt.tag_id and tag.is_active
    where pt.post_id=p.id
  ) t on true
  where p.id=p_post_id and p.status='published' and p.deleted_at is null
$$;

alter function private.scan_public_post_body(text,uuid[],text[]) owner to postgres;
alter function private.public_post_body(uuid,text) owner to postgres;
alter function private.public_post_excerpt(uuid,text) owner to postgres;
alter function public.get_public_post(uuid) owner to postgres;
revoke all on function private.scan_public_post_body(text,uuid[],text[]) from public,anon,authenticated,service_role;
revoke all on function private.public_post_body(uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.public_post_excerpt(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_public_post(uuid) from public,anon,authenticated;
grant execute on function public.get_public_post(uuid) to anon,authenticated;

commit;
