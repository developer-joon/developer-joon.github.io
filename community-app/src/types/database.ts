export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      attachments: {
        Row: {
          attached_at: string | null;
          byte_size: number;
          cleanup_attempt_count: number;
          cleanup_claim_token: string | null;
          cleanup_last_error: string | null;
          cleanup_lease_until: string | null;
          client_key: string | null;
          created_at: string;
          deleted_at: string | null;
          id: string;
          mime_type: string;
          next_attempt_at: string | null;
          owner_id: string;
          payload_sha256: string | null;
          post_id: string | null;
          status: string;
          storage_path: string;
        };
        ComputedFields: never;
        Insert: {
          attached_at?: string | null;
          byte_size: number;
          cleanup_attempt_count?: number;
          cleanup_claim_token?: string | null;
          cleanup_last_error?: string | null;
          cleanup_lease_until?: string | null;
          client_key?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          mime_type: string;
          next_attempt_at?: string | null;
          owner_id: string;
          payload_sha256?: string | null;
          post_id?: string | null;
          status?: string;
          storage_path: string;
        };
        Update: {
          attached_at?: string | null;
          byte_size?: number;
          cleanup_attempt_count?: number;
          cleanup_claim_token?: string | null;
          cleanup_last_error?: string | null;
          cleanup_lease_until?: string | null;
          client_key?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          mime_type?: string;
          next_attempt_at?: string | null;
          owner_id?: string;
          payload_sha256?: string | null;
          post_id?: string | null;
          status?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attachments_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attachments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      benefit_companies: {
        Row: {
          company_id: string;
          created_at: string;
          display_name: string;
          identity_class: string;
          industry: string | null;
          is_searchable: boolean;
          normalized_name: string;
          provenance: NonNullable<Json>;
          region: string | null;
          size_class: string | null;
          source_edition: string;
          summary: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          display_name: string;
          identity_class: string;
          industry?: string | null;
          is_searchable?: boolean;
          normalized_name: string;
          provenance?: NonNullable<Json>;
          region?: string | null;
          size_class?: string | null;
          source_edition: string;
          summary?: string | null;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          display_name?: string;
          identity_class?: string;
          industry?: string | null;
          is_searchable?: boolean;
          normalized_name?: string;
          provenance?: NonNullable<Json>;
          region?: string | null;
          size_class?: string | null;
          source_edition?: string;
          summary?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      benefit_claim_events: {
        Row: {
          actor_snapshot: string;
          claim_id: string;
          client_key: string;
          created_at: string;
          event_id: string;
          event_type:
            | "submitted"
            | "duplicate_directed"
            | "withdrawn"
            | "hidden"
            | "restored"
            | "merged"
            | "promoted"
            | "demoted"
            | "repromoted"
            | "official_reviewed"
            | "official_withdrawn"
            | "reaction_recomputed";
          from_status: "submitted" | "community_confirmed" | "disputed" | "hidden" | "withdrawn" | "merged" | null;
          metadata: NonNullable<Json>;
          operation: "create" | "withdraw" | "moderate" | "promote" | "review";
          payload_fingerprint: string;
          to_status: "submitted" | "community_confirmed" | "disputed" | "hidden" | "withdrawn" | "merged";
        };
        ComputedFields: never;
        Insert: {
          actor_snapshot: string;
          claim_id: string;
          client_key: string;
          created_at?: string;
          event_id?: string;
          event_type:
            | "submitted"
            | "duplicate_directed"
            | "withdrawn"
            | "hidden"
            | "restored"
            | "merged"
            | "promoted"
            | "demoted"
            | "repromoted"
            | "official_reviewed"
            | "official_withdrawn"
            | "reaction_recomputed";
          from_status?: "submitted" | "community_confirmed" | "disputed" | "hidden" | "withdrawn" | "merged" | null;
          metadata?: NonNullable<Json>;
          operation: "create" | "withdraw" | "moderate" | "promote" | "review";
          payload_fingerprint: string;
          to_status: "submitted" | "community_confirmed" | "disputed" | "hidden" | "withdrawn" | "merged";
        };
        Update: {
          actor_snapshot?: string;
          claim_id?: string;
          client_key?: string;
          created_at?: string;
          event_id?: string;
          event_type?:
            | "submitted"
            | "duplicate_directed"
            | "withdrawn"
            | "hidden"
            | "restored"
            | "merged"
            | "promoted"
            | "demoted"
            | "repromoted"
            | "official_reviewed"
            | "official_withdrawn"
            | "reaction_recomputed";
          from_status?: "submitted" | "community_confirmed" | "disputed" | "hidden" | "withdrawn" | "merged" | null;
          metadata?: NonNullable<Json>;
          operation?: "create" | "withdraw" | "moderate" | "promote" | "review";
          payload_fingerprint?: string;
          to_status?: "submitted" | "community_confirmed" | "disputed" | "hidden" | "withdrawn" | "merged";
        };
        Relationships: [
          {
            foreignKeyName: "benefit_claim_events_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "benefit_claims";
            referencedColumns: ["claim_id"];
          },
        ];
      };
      benefit_claim_merges: {
        Row: {
          actor_snapshot: string;
          merged_at: string;
          reaction_lineage: NonNullable<Json>;
          request_client_key: string;
          source_claim_id: string;
          target_claim_id: string;
        };
        ComputedFields: never;
        Insert: {
          actor_snapshot: string;
          merged_at?: string;
          reaction_lineage: NonNullable<Json>;
          request_client_key: string;
          source_claim_id: string;
          target_claim_id: string;
        };
        Update: {
          actor_snapshot?: string;
          merged_at?: string;
          reaction_lineage?: NonNullable<Json>;
          request_client_key?: string;
          source_claim_id?: string;
          target_claim_id?: string;
        };
        Relationships: [
          { foreignKeyName: "benefit_claim_merges_source_claim_id_fkey"; columns: ["source_claim_id"]; isOneToOne: true; referencedRelation: "benefit_claims"; referencedColumns: ["claim_id"] },
          { foreignKeyName: "benefit_claim_merges_target_claim_id_fkey"; columns: ["target_claim_id"]; isOneToOne: false; referencedRelation: "benefit_claims"; referencedColumns: ["claim_id"] },
        ];
      };
      benefit_claim_moderation_requests: {
        Row: { action: "hide" | "restore" | "withdraw" | "user_withdraw" | "merge" | "withdraw_official" | "verify" | "reverify"; actor_snapshot: string; claim_id: string; client_key: string; created_at: string; payload_fingerprint: string; response: NonNullable<Json> };
        ComputedFields: never;
        Insert: { action: "hide" | "restore" | "withdraw" | "user_withdraw" | "merge" | "withdraw_official" | "verify" | "reverify"; actor_snapshot: string; claim_id: string; client_key: string; created_at?: string; payload_fingerprint: string; response: NonNullable<Json> };
        Update: { action?: "hide" | "restore" | "withdraw" | "user_withdraw" | "merge" | "withdraw_official" | "verify" | "reverify"; actor_snapshot?: string; claim_id?: string; client_key?: string; created_at?: string; payload_fingerprint?: string; response?: NonNullable<Json> };
        Relationships: [{ foreignKeyName: "benefit_claim_moderation_requests_claim_id_fkey"; columns: ["claim_id"]; isOneToOne: false; referencedRelation: "benefit_claims"; referencedColumns: ["claim_id"] }];
      };
      benefit_claim_official_reviews: {
        Row: { action: "verify" | "reverify" | "withdraw_official"; claim_id: string; evidence_observed_on: string; evidence_source_url: string; evidence_type: "official_website" | "company_policy" | "regulatory_filing" | "employment_document" | "other_official"; predecessor_publication_id: string | null; publication_id: string; review_id: string; reviewed_at: string; reviewer_snapshot: string; successor_publication_id: string | null; verification_note: string };
        ComputedFields: never;
        Insert: { action: "verify" | "reverify" | "withdraw_official"; claim_id: string; evidence_observed_on: string; evidence_source_url: string; evidence_type: "official_website" | "company_policy" | "regulatory_filing" | "employment_document" | "other_official"; predecessor_publication_id?: string | null; publication_id: string; review_id?: string; reviewed_at?: string; reviewer_snapshot: string; successor_publication_id?: string | null; verification_note: string };
        Update: { action?: "verify" | "reverify" | "withdraw_official"; claim_id?: string; evidence_observed_on?: string; evidence_source_url?: string; evidence_type?: "official_website" | "company_policy" | "regulatory_filing" | "employment_document" | "other_official"; predecessor_publication_id?: string | null; publication_id?: string; review_id?: string; reviewed_at?: string; reviewer_snapshot?: string; successor_publication_id?: string | null; verification_note?: string };
        Relationships: [
          { foreignKeyName: "benefit_claim_official_reviews_claim_id_fkey"; columns: ["claim_id"]; isOneToOne: false; referencedRelation: "benefit_claims"; referencedColumns: ["claim_id"] },
          { foreignKeyName: "benefit_claim_official_reviews_predecessor_publication_id_fkey"; columns: ["predecessor_publication_id"]; isOneToOne: false; referencedRelation: "benefit_publications"; referencedColumns: ["publication_id"] },
          { foreignKeyName: "benefit_claim_official_reviews_publication_id_fkey"; columns: ["publication_id"]; isOneToOne: false; referencedRelation: "benefit_publications"; referencedColumns: ["publication_id"] },
          { foreignKeyName: "benefit_claim_official_reviews_successor_publication_id_fkey"; columns: ["successor_publication_id"]; isOneToOne: false; referencedRelation: "benefit_publications"; referencedColumns: ["publication_id"] },
        ];
      };
      benefit_claim_reaction_requests: {
        Row: {
          actor_snapshot: string;
          claim_id: string;
          client_key: string;
          created_at: string;
          payload_fingerprint: string;
          response: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          actor_snapshot: string;
          claim_id: string;
          client_key: string;
          created_at?: string;
          payload_fingerprint: string;
          response: NonNullable<Json>;
        };
        Update: {
          actor_snapshot?: string;
          claim_id?: string;
          client_key?: string;
          created_at?: string;
          payload_fingerprint?: string;
          response?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "benefit_claim_reaction_requests_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "benefit_claims";
            referencedColumns: ["claim_id"];
          },
        ];
      };
      benefit_claim_reactions: {
        Row: {
          claim_id: string;
          created_at: string;
          reaction: "confirm" | "dispute";
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          claim_id: string;
          created_at?: string;
          reaction: "confirm" | "dispute";
          updated_at?: string;
          user_id: string;
        };
        Update: {
          claim_id?: string;
          created_at?: string;
          reaction?: "confirm" | "dispute";
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "benefit_claim_reactions_claim_id_fkey";
            columns: ["claim_id"];
            isOneToOne: false;
            referencedRelation: "benefit_claims";
            referencedColumns: ["claim_id"];
          },
        ];
      };
      benefit_claims: {
        Row: {
          active_publication_id: string | null;
          category_id: "leave" | "family" | "health" | "growth" | "housing" | "commute" | "remote" | "retirement" | "meals" | "inclusion";
          claim_id: string;
          client_key: string;
          company_id: string;
          condition_text: string | null;
          created_at: string;
          description: string;
          eligibility_text: string | null;
          normalized_eligibility: string;
          normalized_title: string;
          observed_on: string;
          official_publication_id: string | null;
          merged_into_claim_id: string | null;
          payload_fingerprint: string;
          revision: number;
          source_url: string | null;
          status: "submitted" | "community_confirmed" | "disputed" | "hidden" | "withdrawn" | "merged";
          submitter_id: string | null;
          title: string;
          updated_at: string;
          withdrawn_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          active_publication_id?: string | null;
          category_id: "leave" | "family" | "health" | "growth" | "housing" | "commute" | "remote" | "retirement" | "meals" | "inclusion";
          claim_id?: string;
          client_key: string;
          company_id: string;
          condition_text?: string | null;
          created_at?: string;
          description: string;
          eligibility_text?: string | null;
          normalized_eligibility?: string;
          normalized_title: string;
          observed_on: string;
          official_publication_id?: string | null;
          merged_into_claim_id?: string | null;
          payload_fingerprint: string;
          revision?: number;
          source_url?: string | null;
          status?: "submitted" | "community_confirmed" | "disputed" | "hidden" | "withdrawn" | "merged";
          submitter_id?: string | null;
          title: string;
          updated_at?: string;
          withdrawn_at?: string | null;
        };
        Update: {
          active_publication_id?: string | null;
          category_id?: "leave" | "family" | "health" | "growth" | "housing" | "commute" | "remote" | "retirement" | "meals" | "inclusion";
          claim_id?: string;
          client_key?: string;
          company_id?: string;
          condition_text?: string | null;
          created_at?: string;
          description?: string;
          eligibility_text?: string | null;
          normalized_eligibility?: string;
          normalized_title?: string;
          observed_on?: string;
          official_publication_id?: string | null;
          merged_into_claim_id?: string | null;
          payload_fingerprint?: string;
          revision?: number;
          source_url?: string | null;
          status?: "submitted" | "community_confirmed" | "disputed" | "hidden" | "withdrawn" | "merged";
          submitter_id?: string | null;
          title?: string;
          updated_at?: string;
          withdrawn_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "benefit_claims_active_publication_id_fkey";
            columns: ["active_publication_id"];
            isOneToOne: false;
            referencedRelation: "benefit_publications";
            referencedColumns: ["publication_id"];
          },
          {
            foreignKeyName: "benefit_claims_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "benefit_companies";
            referencedColumns: ["company_id"];
          },
          {
            foreignKeyName: "benefit_claims_merged_into_claim_id_fkey";
            columns: ["merged_into_claim_id"];
            isOneToOne: false;
            referencedRelation: "benefit_claims";
            referencedColumns: ["claim_id"];
          },
          {
            foreignKeyName: "benefit_claims_official_publication_id_fkey";
            columns: ["official_publication_id"];
            isOneToOne: false;
            referencedRelation: "benefit_publications";
            referencedColumns: ["publication_id"];
          },
          {
            foreignKeyName: "benefit_claims_submitter_id_fkey";
            columns: ["submitter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      benefit_company_add_events: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_kind: string;
          created_at: string;
          event_id: string;
          from_status: string | null;
          metadata: NonNullable<Json>;
          request_id: string;
          resolved_company_id: string | null;
          to_status: string;
          verification_category: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_kind: string;
          created_at?: string;
          event_id?: string;
          from_status?: string | null;
          metadata?: NonNullable<Json>;
          request_id: string;
          resolved_company_id?: string | null;
          to_status: string;
          verification_category?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_kind?: string;
          created_at?: string;
          event_id?: string;
          from_status?: string | null;
          metadata?: NonNullable<Json>;
          request_id?: string;
          resolved_company_id?: string | null;
          to_status?: string;
          verification_category?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "benefit_company_add_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "benefit_company_add_events_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "benefit_company_add_requests";
            referencedColumns: ["request_id"];
          },
          {
            foreignKeyName: "benefit_company_add_events_resolved_company_id_fkey";
            columns: ["resolved_company_id"];
            isOneToOne: false;
            referencedRelation: "benefit_companies";
            referencedColumns: ["company_id"];
          },
        ];
      };
      benefit_company_add_requests: {
        Row: {
          business_number_digest: string | null;
          client_key: string;
          created_at: string;
          external_verified_at: string | null;
          industry: string | null;
          normalized_name: string;
          payload_fingerprint: string;
          processed_at: string | null;
          proposed_name: string;
          region: string | null;
          request_id: string;
          requester_id: string;
          resolved_company_id: string | null;
          revision: number;
          reviewer_id: string | null;
          status: string;
          updated_at: string;
          verification_method: string;
          verification_status: string;
          website: string | null;
        };
        ComputedFields: never;
        Insert: {
          business_number_digest?: string | null;
          client_key: string;
          created_at?: string;
          external_verified_at?: string | null;
          industry?: string | null;
          normalized_name: string;
          payload_fingerprint: string;
          processed_at?: string | null;
          proposed_name: string;
          region?: string | null;
          request_id?: string;
          requester_id: string;
          resolved_company_id?: string | null;
          revision?: number;
          reviewer_id?: string | null;
          status?: string;
          updated_at?: string;
          verification_method: string;
          verification_status?: string;
          website?: string | null;
        };
        Update: {
          business_number_digest?: string | null;
          client_key?: string;
          created_at?: string;
          external_verified_at?: string | null;
          industry?: string | null;
          normalized_name?: string;
          payload_fingerprint?: string;
          processed_at?: string | null;
          proposed_name?: string;
          region?: string | null;
          request_id?: string;
          requester_id?: string;
          resolved_company_id?: string | null;
          revision?: number;
          reviewer_id?: string | null;
          status?: string;
          updated_at?: string;
          verification_method?: string;
          verification_status?: string;
          website?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "benefit_company_add_requests_requester_id_fkey";
            columns: ["requester_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "benefit_company_add_requests_resolved_company_id_fkey";
            columns: ["resolved_company_id"];
            isOneToOne: false;
            referencedRelation: "benefit_companies";
            referencedColumns: ["company_id"];
          },
          {
            foreignKeyName: "benefit_company_add_requests_reviewer_id_fkey";
            columns: ["reviewer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      // Project-owned tightening: Supabase generation widens CHECK-constrained text to string;
      // keep the migration 003 identifier contract exact and guard it with database.identifier-types.test-d.ts.
      benefit_company_identifiers: {
        Row: {
          company_id: string;
          created_at: string;
          identifier_digest_or_value: string;
          identifier_id: string;
          identifier_type: "legacy_company_id" | "opendart_corp_code" | "business_number_hmac_v1";
          source_edition: string;
          updated_at: string;
          verified_at: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          identifier_digest_or_value: string;
          identifier_id?: string;
          identifier_type: "legacy_company_id" | "opendart_corp_code" | "business_number_hmac_v1";
          source_edition: string;
          updated_at?: string;
          verified_at: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          identifier_digest_or_value?: string;
          identifier_id?: string;
          identifier_type?: "legacy_company_id" | "opendart_corp_code" | "business_number_hmac_v1";
          source_edition?: string;
          updated_at?: string;
          verified_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "benefit_company_identifiers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "benefit_companies";
            referencedColumns: ["company_id"];
          },
        ];
      };
      benefit_company_merge_events: {
        Row: {
          actor_id: string;
          created_at: string;
          destination_company_id: string;
          merge_event_id: string;
          reason: string;
          source_company_id: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id: string;
          created_at?: string;
          destination_company_id: string;
          merge_event_id?: string;
          reason: string;
          source_company_id: string;
        };
        Update: {
          actor_id?: string;
          created_at?: string;
          destination_company_id?: string;
          merge_event_id?: string;
          reason?: string;
          source_company_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "benefit_company_merge_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "benefit_company_merge_events_destination_company_id_fkey";
            columns: ["destination_company_id"];
            isOneToOne: false;
            referencedRelation: "benefit_companies";
            referencedColumns: ["company_id"];
          },
          {
            foreignKeyName: "benefit_company_merge_events_source_company_id_fkey";
            columns: ["source_company_id"];
            isOneToOne: false;
            referencedRelation: "benefit_companies";
            referencedColumns: ["company_id"];
          },
        ];
      };
      benefit_correction_events: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_kind: string;
          actor_snapshot: string;
          applied_data_version: string | null;
          client_key: string;
          created_at: string;
          from_status: string | null;
          id: string;
          operation: string;
          payload_fingerprint: string;
          request_id: string;
          response_text: string | null;
          to_status: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_kind: string;
          actor_snapshot: string;
          applied_data_version?: string | null;
          client_key: string;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          operation: string;
          payload_fingerprint: string;
          request_id: string;
          response_text?: string | null;
          to_status: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_kind?: string;
          actor_snapshot?: string;
          applied_data_version?: string | null;
          client_key?: string;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          operation?: string;
          payload_fingerprint?: string;
          request_id?: string;
          response_text?: string | null;
          to_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "benefit_correction_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "benefit_correction_events_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "benefit_correction_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      benefit_correction_operator_rate_events: {
        Row: {
          action: string;
          actor_snapshot: string;
          id: string;
          idempotency_key: string;
          occurred_at: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_snapshot: string;
          id?: string;
          idempotency_key: string;
          occurred_at?: string;
        };
        Update: {
          action?: string;
          actor_snapshot?: string;
          id?: string;
          idempotency_key?: string;
          occurred_at?: string;
        };
        Relationships: [];
      };
      benefit_correction_requests: {
        Row: {
          admin_response: string | null;
          applied_at: string | null;
          applied_data_version: string | null;
          category_id: string;
          client_key: string;
          company_id: string;
          created_at: string;
          current_text: string;
          id: string;
          observed_data_version: string;
          payload_fingerprint: string;
          proposed_text: string;
          reviewed_at: string | null;
          reviewer_id: string | null;
          scope_text: string;
          source_url: string;
          status: string;
          submitter_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          admin_response?: string | null;
          applied_at?: string | null;
          applied_data_version?: string | null;
          category_id: string;
          client_key: string;
          company_id: string;
          created_at?: string;
          current_text: string;
          id?: string;
          observed_data_version: string;
          payload_fingerprint: string;
          proposed_text: string;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          scope_text: string;
          source_url: string;
          status?: string;
          submitter_id: string;
          updated_at?: string;
        };
        Update: {
          admin_response?: string | null;
          applied_at?: string | null;
          applied_data_version?: string | null;
          category_id?: string;
          client_key?: string;
          company_id?: string;
          created_at?: string;
          current_text?: string;
          id?: string;
          observed_data_version?: string;
          payload_fingerprint?: string;
          proposed_text?: string;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          scope_text?: string;
          source_url?: string;
          status?: string;
          submitter_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "benefit_correction_requests_reviewer_id_fkey";
            columns: ["reviewer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "benefit_correction_requests_submitter_id_fkey";
            columns: ["submitter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      benefit_publications: {
        Row: {
          category_id: string;
          company_id: string;
          condition_text: string | null;
          created_at: string;
          dedupe_key: string;
          description: string;
          eligibility_text: string | null;
          observed_at: string | null;
          provenance: NonNullable<Json>;
          publication_id: string;
          reviewer_id: string | null;
          revision: number;
          source_type: string;
          source_url: string | null;
          status: string;
          supersedes_publication_id: string | null;
          title: string;
          trust_tier: string;
          updated_at: string;
          verified_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          category_id: string;
          company_id: string;
          condition_text?: string | null;
          created_at?: string;
          dedupe_key: string;
          description: string;
          eligibility_text?: string | null;
          observed_at?: string | null;
          provenance?: NonNullable<Json>;
          publication_id?: string;
          reviewer_id?: string | null;
          revision: number;
          source_type: string;
          source_url?: string | null;
          status?: string;
          supersedes_publication_id?: string | null;
          title: string;
          trust_tier: string;
          updated_at?: string;
          verified_at?: string | null;
        };
        Update: {
          category_id?: string;
          company_id?: string;
          condition_text?: string | null;
          created_at?: string;
          dedupe_key?: string;
          description?: string;
          eligibility_text?: string | null;
          observed_at?: string | null;
          provenance?: NonNullable<Json>;
          publication_id?: string;
          reviewer_id?: string | null;
          revision?: number;
          source_type?: string;
          source_url?: string | null;
          status?: string;
          supersedes_publication_id?: string | null;
          title?: string;
          trust_tier?: string;
          updated_at?: string;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "benefit_publications_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "benefit_companies";
            referencedColumns: ["company_id"];
          },
          {
            foreignKeyName: "benefit_publications_supersedes_publication_id_fkey";
            columns: ["supersedes_publication_id"];
            isOneToOne: false;
            referencedRelation: "benefit_publications";
            referencedColumns: ["publication_id"];
          },
        ];
      };
      benefit_submission_events: {
        Row: {
          action: string;
          actor_id: string;
          client_key: string;
          created_at: string;
          from_status: string | null;
          id: string;
          operation: string;
          payload_fingerprint: string;
          publication_id: string | null;
          response_text: string | null;
          submission_id: string;
          to_status: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id: string;
          client_key: string;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          operation: string;
          payload_fingerprint: string;
          publication_id?: string | null;
          response_text?: string | null;
          submission_id: string;
          to_status: string;
        };
        Update: {
          action?: string;
          actor_id?: string;
          client_key?: string;
          created_at?: string;
          from_status?: string | null;
          id?: string;
          operation?: string;
          payload_fingerprint?: string;
          publication_id?: string | null;
          response_text?: string | null;
          submission_id?: string;
          to_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "benefit_submission_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "benefit_submission_events_publication_id_fkey";
            columns: ["publication_id"];
            isOneToOne: false;
            referencedRelation: "benefit_publications";
            referencedColumns: ["publication_id"];
          },
          {
            foreignKeyName: "benefit_submission_events_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "benefit_submissions";
            referencedColumns: ["id"];
          },
        ];
      };
      benefit_submissions: {
        Row: {
          admin_response: string | null;
          benefit_text: string;
          category_id: string;
          client_key: string;
          company_id: string;
          condition_text: string | null;
          created_at: string;
          eligibility_text: string | null;
          id: string;
          payload_fingerprint: string;
          publication_id: string | null;
          reviewed_at: string | null;
          reviewer_id: string | null;
          source_url: string | null;
          status: string;
          submitter_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          admin_response?: string | null;
          benefit_text: string;
          category_id: string;
          client_key: string;
          company_id: string;
          condition_text?: string | null;
          created_at?: string;
          eligibility_text?: string | null;
          id?: string;
          payload_fingerprint: string;
          publication_id?: string | null;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          source_url?: string | null;
          status?: string;
          submitter_id: string;
          updated_at?: string;
        };
        Update: {
          admin_response?: string | null;
          benefit_text?: string;
          category_id?: string;
          client_key?: string;
          company_id?: string;
          condition_text?: string | null;
          created_at?: string;
          eligibility_text?: string | null;
          id?: string;
          payload_fingerprint?: string;
          publication_id?: string | null;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          source_url?: string | null;
          status?: string;
          submitter_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "benefit_submissions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "benefit_companies";
            referencedColumns: ["company_id"];
          },
          {
            foreignKeyName: "benefit_submissions_publication_id_fkey";
            columns: ["publication_id"];
            isOneToOne: false;
            referencedRelation: "benefit_publications";
            referencedColumns: ["publication_id"];
          },
          {
            foreignKeyName: "benefit_submissions_reviewer_id_fkey";
            columns: ["reviewer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "benefit_submissions_submitter_id_fkey";
            columns: ["submitter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      comment_reactions: {
        Row: {
          comment_id: string;
          created_at: string;
          id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          comment_id: string;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          comment_id?: string;
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comment_reactions_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comment_reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      comments: {
        Row: {
          author_id: string;
          body_markdown: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          parent_id: string | null;
          post_id: string;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          author_id: string;
          body_markdown: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          parent_id?: string | null;
          post_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          author_id?: string;
          body_markdown?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          parent_id?: string | null;
          post_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_parent_id_post_id_fkey";
            columns: ["parent_id", "post_id"];
            isOneToOne: false;
            referencedRelation: "comments";
            referencedColumns: ["id", "post_id"];
          },
          {
            foreignKeyName: "comments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      idempotency_keys: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          key: string;
          operation: string;
          request_hash: string;
          resource_id: string | null;
          resource_type: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          key: string;
          operation: string;
          request_hash: string;
          resource_id?: string | null;
          resource_type?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          key?: string;
          operation?: string;
          request_hash?: string;
          resource_id?: string | null;
          resource_type?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      moderation_audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          id: string;
          metadata: NonNullable<Json>;
          reason: string | null;
          target_id: string;
          target_type: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          metadata?: NonNullable<Json>;
          reason?: string | null;
          target_id: string;
          target_type: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          metadata?: NonNullable<Json>;
          reason?: string | null;
          target_id?: string;
          target_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moderation_audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      post_reactions: {
        Row: {
          created_at: string;
          id: string;
          post_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          post_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          post_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_reactions_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      post_tags: {
        Row: {
          post_id: string;
          tag_id: string;
        };
        ComputedFields: never;
        Insert: {
          post_id: string;
          tag_id: string;
        };
        Update: {
          post_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_tags_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: {
          author_id: string;
          body_markdown: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_locked: boolean;
          is_pinned: boolean;
          status: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          author_id: string;
          body_markdown: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_locked?: boolean;
          is_pinned?: boolean;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          author_id?: string;
          body_markdown?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_locked?: boolean;
          is_pinned?: boolean;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          github_user_id: number | null;
          id: string;
          login: string;
          metadata_provider: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          github_user_id?: number | null;
          id: string;
          login: string;
          metadata_provider?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          github_user_id?: number | null;
          id?: string;
          login?: string;
          metadata_provider?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      rate_limit_events: {
        Row: {
          action: string;
          id: string;
          idempotency_key: string | null;
          occurred_at: string;
          upload_reservation_id: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          id?: string;
          idempotency_key?: string | null;
          occurred_at?: string;
          upload_reservation_id?: string | null;
          user_id: string;
        };
        Update: {
          action?: string;
          id?: string;
          idempotency_key?: string | null;
          occurred_at?: string;
          upload_reservation_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rate_limit_events_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limit_rules: {
        Row: {
          action: string;
          created_at: string;
          id: string;
          is_enabled: boolean;
          max_requests: number;
          updated_at: string;
          window_seconds: number;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          created_at?: string;
          id?: string;
          is_enabled?: boolean;
          max_requests: number;
          updated_at?: string;
          window_seconds: number;
        };
        Update: {
          action?: string;
          created_at?: string;
          id?: string;
          is_enabled?: boolean;
          max_requests?: number;
          updated_at?: string;
          window_seconds?: number;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          created_at: string;
          detail: string | null;
          id: string;
          reason_code: string;
          reporter_id: string;
          resolved_at: string | null;
          resolved_by: string | null;
          status: string;
          target_id: string;
          target_type: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          detail?: string | null;
          id?: string;
          reason_code: string;
          reporter_id: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
          target_id: string;
          target_type: string;
        };
        Update: {
          created_at?: string;
          detail?: string | null;
          id?: string;
          reason_code?: string;
          reporter_id?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
          target_id?: string;
          target_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reports_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tags: {
        Row: {
          id: string;
          is_active: boolean;
          label: string;
          slug: string;
          sort_order: number;
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          is_active?: boolean;
          label: string;
          slug: string;
          sort_order?: number;
        };
        Update: {
          id?: string;
          is_active?: boolean;
          label?: string;
          slug?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          granted_at: string;
          granted_by: string | null;
          role: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          granted_at?: string;
          granted_by?: string | null;
          role?: string;
          user_id: string;
        };
        Update: {
          granted_at?: string;
          granted_by?: string | null;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_roles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      attach_attachments: {
        Args: { p_attachment_ids: string[]; p_expected_total: number; p_post_id: string };
        Returns: number;
      };
      attach_attachments_legacy: {
        Args: { p_attachment_ids: string[]; p_post_id: string };
        Returns: number;
      };
      claim_attachment_cleanup: {
        Args: { p_limit?: number };
        Returns: {
          claim_token: string;
          id: string;
          storage_path: string;
        }[];
      };
      complete_attachment_cleanup: {
        Args: { p_attachment_id: string; p_claim_token: string; p_storage_path: string };
        Returns: boolean;
      };
      create_attachment_upload_intent: {
        Args: {
          p_byte_size: number;
          p_content_hash: string;
          p_idempotency_key: string;
          p_mime_type: string;
        };
        Returns: Database["public"]["CompositeTypes"]["attachment_upload_intent"];
        SetofOptions: {
          from: "*";
          to: "attachment_upload_intent";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_benefit_claim_v1: {
        Args: {
          p_category_id: "leave" | "family" | "health" | "growth" | "housing" | "commute" | "remote" | "retirement" | "meals" | "inclusion";
          p_client_key: string;
          p_company_id: string;
          p_condition_text?: string;
          p_description: string;
          p_eligibility_text?: string;
          p_observed_on?: string;
          p_source_url?: string;
          p_title: string;
        };
        Returns: Json;
      };
      create_benefit_correction_request_v1: {
        Args: {
          p_category_id: string;
          p_client_key: string;
          p_company_id: string;
          p_current_text: string;
          p_observed_data_version: string;
          p_proposed_text: string;
          p_scope_text: string;
          p_source_url: string;
        };
        Returns: Json;
      };
      create_benefit_submission_v1: {
        Args: {
          p_benefit_text: string;
          p_category_id: string;
          p_client_key: string;
          p_company_id: string;
          p_condition_text?: string;
          p_eligibility_text?: string;
          p_source_url?: string;
        };
        Returns: Json;
      };
      create_comment: {
        Args: {
          p_body_markdown: string;
          p_idempotency_key: string;
          p_parent_id: string;
          p_post_id: string;
        };
        Returns: string;
      };
      create_comment_v2: {
        Args: {
          p_body_markdown: string;
          p_idempotency_key: string;
          p_parent_id: string;
          p_post_id: string;
        };
        Returns: Json;
      };
      create_manual_benefit_company_request_v1: {
        Args: {
          p_client_key: string;
          p_industry?: string;
          p_proposed_name: string;
          p_region?: string;
          p_website?: string;
        };
        Returns: Json;
      };
      create_post: {
        Args: {
          p_body_markdown: string;
          p_idempotency_key: string;
          p_tag_ids: string[];
          p_title: string;
        };
        Returns: string;
      };
      create_report: {
        Args: {
          p_detail: string;
          p_idempotency_key: string;
          p_reason_code: string;
          p_target_id: string;
          p_target_type: string;
        };
        Returns: string;
      };
      create_report_v2: {
        Args: {
          p_detail: string;
          p_idempotency_key: string;
          p_reason_code: string;
          p_target_id: string;
          p_target_type: string;
        };
        Returns: string;
      };
      fail_attachment_upload: {
        Args: { p_attachment_id: string; p_storage_path: string };
        Returns: boolean;
      };
      fail_benefit_company_nts_request_v1: {
        Args: {
          p_expected_verification_status: string;
          p_failure_category: string;
          p_payload_fingerprint: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      finalize_benefit_company_nts_request_v1: {
        Args: {
          p_business_number_digest: string;
          p_expected_verification_status: string;
          p_external_verified_at: string;
          p_payload_fingerprint: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      get_benefit_company_v1: { Args: { p_company_id: string }; Returns: Json };
      get_benefit_company_v2: { Args: { p_company_id: string }; Returns: Json };
      get_public_post: {
        Args: { p_post_id: string };
        Returns: {
          author_avatar_url: string;
          author_display_name: string;
          author_id: string;
          author_login: string;
          body_markdown: string;
          comment_count: number;
          created_at: string;
          id: string;
          is_locked: boolean;
          is_pinned: boolean;
          popularity_score: number;
          reaction_count: number;
          tags: Json;
          title: string;
          updated_at: string;
        }[];
      };
      get_public_post_v2: { Args: { p_post_id: string }; Returns: Json };
      get_public_post_v3: { Args: { p_post_id: string }; Returns: Json };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      list_benefit_claim_audit_v1: {
        Args: { p_claim_id: string; p_cursor_created_at?: string; p_cursor_kind?: "claim_event" | "official_review" | "merge"; p_cursor_id?: string; p_limit?: number };
        Returns: Json;
      };
      list_benefit_claim_moderation_queue_v1: {
        Args: { p_cursor_created_at?: string; p_cursor_id?: string; p_limit?: number; p_status?: "active" | "submitted" | "community_confirmed" | "disputed" | "hidden" | "withdrawn" | "merged" | "all" };
        Returns: Json;
      };
      list_benefit_company_request_queue_v1: {
        Args: {
          p_cursor_created_at?: string;
          p_cursor_id?: string;
          p_limit?: number;
          p_status?: string;
        };
        Returns: Json;
      };
      list_benefit_correction_audit_v1: {
        Args: {
          p_cursor_created_at?: string;
          p_cursor_sequence?: string;
          p_limit?: number;
          p_request_id: string;
        };
        Returns: Json;
      };
      list_benefit_correction_queue_v1: {
        Args: {
          p_cursor_created_at?: string;
          p_cursor_id?: string;
          p_limit?: number;
          p_status?: string;
        };
        Returns: Json;
      };
      list_benefit_submission_audit_v1: {
        Args: {
          p_cursor_created_at?: string;
          p_cursor_sequence?: string;
          p_limit?: number;
          p_submission_id: string;
        };
        Returns: Json;
      };
      list_benefit_submission_queue_v1: {
        Args: {
          p_cursor_created_at?: string;
          p_cursor_id?: string;
          p_limit?: number;
          p_status?: string;
        };
        Returns: Json;
      };
      list_moderation_audit_logs_v1: {
        Args: {
          p_cursor_created_at?: string;
          p_cursor_id?: string;
          p_limit?: number;
          p_target_id?: string;
          p_target_type?: string;
        };
        Returns: Json;
      };
      list_moderation_reports_v1: {
        Args: {
          p_cursor_created_at?: string;
          p_cursor_id?: string;
          p_limit?: number;
          p_status?: string;
        };
        Returns: Json;
      };
      list_my_benefit_claims_v1: {
        Args: { p_cursor_created_at?: string; p_cursor_id?: string; p_limit?: number };
        Returns: Json;
      };
      list_my_benefit_company_requests_v1: {
        Args: { p_cursor_created_at?: string; p_cursor_id?: string; p_limit?: number };
        Returns: Json;
      };
      list_my_benefit_correction_requests_v1: {
        Args: { p_cursor_created_at?: string; p_cursor_id?: string; p_limit?: number };
        Returns: Json;
      };
      list_my_benefit_submissions_v1: {
        Args: { p_cursor_created_at?: string; p_cursor_id?: string; p_limit?: number };
        Returns: Json;
      };
      list_public_community_snapshots_v1: {
        Args: {
          p_cursor_created_at?: string;
          p_cursor_id?: string;
          p_limit: number;
          p_snapshot_at?: string;
        };
        Returns: Json;
      };
      list_public_post_comments: {
        Args: {
          p_cursor_created_at?: string;
          p_cursor_id?: string;
          p_cursor_is_reply?: boolean;
          p_cursor_root_created_at?: string;
          p_cursor_root_id?: string;
          p_limit?: number;
          p_post_id: string;
        };
        Returns: Json;
      };
      list_public_post_comments_v2: {
        Args: {
          p_cursor_created_at?: string;
          p_cursor_id?: string;
          p_cursor_is_reply?: boolean;
          p_cursor_root_created_at?: string;
          p_cursor_root_id?: string;
          p_limit?: number;
          p_post_id: string;
        };
        Returns: Json;
      };
      list_public_posts: {
        Args: {
          p_cursor_created_at?: string;
          p_cursor_id?: string;
          p_cursor_is_pinned?: boolean;
          p_cursor_rank?: number;
          p_cursor_search_rank?: number;
          p_limit: number;
          p_search?: string;
          p_sort: string;
          p_tag_id?: string;
        };
        Returns: {
          author_avatar_url: string;
          author_display_name: string;
          author_id: string;
          author_login: string;
          comment_count: number;
          created_at: string;
          excerpt: string;
          id: string;
          is_locked: boolean;
          is_pinned: boolean;
          popularity_score: number;
          rank_key: number;
          reaction_count: number;
          row_number: number;
          search_rank: number;
          tags: Json;
          title: string;
          updated_at: string;
        }[];
      };
      mark_benefit_correction_applied_v1: {
        Args: {
          p_applied_data_version: string;
          p_client_key: string;
          p_expected_status: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      moderate_benefit_claim_v1: {
        Args: {
          p_action: "hide" | "restore" | "withdraw" | "merge" | "withdraw_official";
          p_claim_id: string;
          p_client_key: string;
          p_evidence_observed_on?: string;
          p_evidence_source_url?: string;
          p_evidence_type?: "official_website" | "company_policy" | "regulatory_filing" | "employment_document" | "other_official";
          p_expected_revision: number;
          p_expected_status: "submitted" | "community_confirmed" | "disputed" | "hidden" | "withdrawn";
          p_reason?: string;
          p_target_claim_id?: string;
        };
        Returns: Json;
      };
      moderate_comment_v1: {
        Args: {
          p_action: string;
          p_comment_id: string;
          p_expected_status: string;
          p_idempotency_key: string;
          p_reason: string;
        };
        Returns: Json;
      };
      moderate_post_v1: {
        Args: {
          p_action: string;
          p_expected_locked: boolean;
          p_expected_pinned: boolean;
          p_expected_status: string;
          p_idempotency_key: string;
          p_post_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
      officially_verify_benefit_claim_v1: {
        Args: {
          p_claim_id: string;
          p_client_key: string;
          p_condition_text: string | null;
          p_description: string;
          p_eligibility_text: string | null;
          p_evidence_observed_on: string;
          p_evidence_source_url: string;
          p_evidence_type: "official_website" | "company_policy" | "regulatory_filing" | "employment_document" | "other_official";
          p_expected_revision: number;
          p_expected_status: "submitted" | "community_confirmed" | "disputed" | "hidden" | "withdrawn";
          p_title: string;
          p_verification_note: string;
        };
        Returns: Json;
      };
      prepare_attachment_cleanup: {
        Args: { p_attachment_id: string; p_claim_token: string; p_storage_path: string };
        Returns: boolean;
      };
      refund_attachment_upload_replay: {
        Args: {
          p_byte_size: number;
          p_content_hash: string;
          p_idempotency_key: string;
          p_mime_type: string;
          p_reservation_id: string;
        };
        Returns: boolean;
      };
      release_attachment_cleanup: {
        Args: {
          p_attachment_id: string;
          p_claim_token: string;
          p_reason: string;
          p_storage_path: string;
        };
        Returns: boolean;
      };
      reserve_attachment_upload: { Args: { p_idempotency_key: string }; Returns: string };
      reserve_benefit_company_nts_request_v1: {
        Args: {
          p_client_key: string;
          p_industry?: string;
          p_proposed_name: string;
          p_region?: string;
          p_website?: string;
        };
        Returns: Json;
      };
      resolve_public_attachment: {
        Args: { p_attachment_id: string };
        Returns: {
          attachment_id: string;
          byte_size: number;
          mime_type: string;
          object_token: string;
          owner_id: string;
          storage_path: string;
        }[];
      };
      review_benefit_company_request_v1: {
        Args: {
          p_action: string;
          p_destination_company_id?: string;
          p_expected_revision: number;
          p_expected_status: string;
          p_reason: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      review_benefit_correction_request_v1: {
        Args: {
          p_action: string;
          p_admin_response: string;
          p_client_key: string;
          p_expected_status: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      review_benefit_submission_v1: {
        Args: {
          p_action: string;
          p_admin_response: string;
          p_client_key: string;
          p_existing_publication_id?: string;
          p_expected_status: string;
          p_public_condition?: string;
          p_public_description?: string;
          p_public_eligibility?: string;
          p_public_title?: string;
          p_submission_id: string;
        };
        Returns: Json;
      };
      search_benefit_companies_v1: {
        Args: {
          p_categories?: string[];
          p_cursor?: string;
          p_has_benefits_only?: boolean;
          p_industry?: string;
          p_page_size?: number;
          p_query?: string;
          p_region?: string;
          p_size?: string;
        };
        Returns: Json;
      };
      set_benefit_claim_reaction_v1: {
        Args: { p_claim_id: string; p_client_key: string; p_reaction: "confirm" | "dispute" | null };
        Returns: Json;
      };
      set_comment_reaction: { Args: { p_comment_id: string; p_reacted: boolean }; Returns: Json };
      set_post_reaction: { Args: { p_post_id: string; p_reacted: boolean }; Returns: Json };
      set_report_status_v1: {
        Args: {
          p_desired_status: string;
          p_expected_status: string;
          p_idempotency_key: string;
          p_reason: string;
          p_report_id: string;
        };
        Returns: Json;
      };
      set_tag_active_v1: {
        Args: {
          p_desired_active: boolean;
          p_expected_active: boolean;
          p_idempotency_key: string;
          p_reason: string;
          p_tag_id: string;
        };
        Returns: Json;
      };
      soft_delete_comment: { Args: { p_comment_id: string }; Returns: string };
      soft_delete_post: { Args: { p_post_id: string }; Returns: string };
      toggle_comment_reaction: { Args: { p_comment_id: string }; Returns: boolean };
      toggle_post_reaction: { Args: { p_post_id: string }; Returns: boolean };
      withdraw_benefit_claim_v1: {
        Args: {
          p_claim_id: string;
          p_client_key: string;
          p_expected_revision: number;
          p_expected_status: "submitted" | "community_confirmed" | "disputed";
        };
        Returns: Json;
      };
      update_comment: { Args: { p_body_markdown: string; p_comment_id: string }; Returns: string };
      update_post: {
        Args: { p_body_markdown: string; p_post_id: string; p_tag_ids: string[]; p_title: string };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      attachment_upload_intent: {
        id: string | null;
        storage_path: string | null;
        is_replay: boolean | null;
        object_exists: boolean | null;
      };
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
