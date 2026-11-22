---
title: 'DB 조회가 필요한 입력 검증을 스레드 블로킹 없이 처리하기: ASP.NET Core 11 비동기 검증'
date: 2026-11-22 08:00:00 +0900
categories: ["개발/백엔드"]
description: 'ASP.NET Core 11 비동기 검증에서 DB 사전 조회와 unique constraint의 경계를 설계한다.'
featured_image: 'https://picsum.photos/seed/hotnews-dotnet11-validation/1600/900'
tags: [dotnet, aspnet-core, minimal-api, async-validation, validation]
---

![강 위의 다리 아래로 펼쳐진 야간 도시 스카이라인](https://picsum.photos/seed/hotnews-dotnet11-validation/1600/900)

.NET 11은 정식 출시(GA)됐고, **Standard Term Support(STS) 릴리스로 2년간 지원**된다. Microsoft는 STS와 LTS의 품질·서비스 정책은 같고 지원 기간이 다르다고 설명한다.[1] ASP.NET Core의 `AsyncValidationAttribute`와 `IAsyncValidatableObject`는 Minimal API와 Blazor에서 DB 조회나 원격 호출을 `await`할 수 있게 한다.[1][2]

그러나 `await`가 입력 검증과 정합성을 하나로 만들지는 않는다. **요청 취소, 동기 fail-fast, pending·faulted, 유일성 경쟁은 별도 계약**이어야 한다.

## 비동기 검증이 보장하는 것과 보장하지 않는 것

Minimal API는 handler 전에 요청 모델을 검증하며 항상 비동기 경로를 호출한다. 같은 멤버의 비동기 속성과 컬렉션 항목은 병렬로 검증될 수 있고, 실행·완료 순서는 보장되지 않는다. “A가 캐시를 채운 뒤 B가 읽는다” 같은 규칙은 금물이다.[3][2]

Validator는 공유 가변 상태 없이 호출마다 DB context를 빌리고 `CancellationToken`을 I/O까지 넘겨야 한다. 형식·길이는 `[Required]`, `[EmailAddress]` 같은 동기 규칙으로 먼저 거른다.

DB 조회는 **사전 확인**이다. 두 요청이 동시에 “없음”을 읽고 INSERT할 수 있다. 최종 정합성은 DB unique constraint가 지키며 애플리케이션은 위반을 충돌 응답으로 번역한다.

## 네 계약을 한 번에 섞지 않는다

| 계약 | 성공 조건 | 실패를 숨기면 생기는 문제 |
|---|---|---|
| 취소 | 클라이언트 연결 종료·timeout이 DB 조회를 중단 | 이미 버려진 요청이 connection과 작업 슬롯을 계속 점유 |
| 동기 fail-fast | async-only 규칙을 동기 API로 부르면 즉시 예외 | 중요한 검증이 조용히 생략됨 |
| pending·faulted | 진행 중과 인프라 오류를 invalid와 구분 | 장애를 “사용 가능한 값” 또는 평범한 입력 오류로 오인 |
| 유일성 | DB unique constraint와 충돌 처리 | 사전 조회와 INSERT 사이의 race로 중복 저장 |

Blazor `EditContext`는 교체된 검증을 취소하고 `IsValidationPending(field)`와 `IsValidationFaulted(field)`를 제공한다.[2] Minimal API에서는 DB 장애를 “중복 아님”으로 바꾸지 말고 5xx로 남긴다.

## 제안 fixture: Minimal API와 SQLite unique constraint

아래 단일 `Program.cs`는 `net11.0`과 `Microsoft.EntityFrameworkCore.Sqlite` 11.0.0을 전제로 한다. SDK 11.0 컨테이너에서 package restore와 Release build를 실행해 경고 2건, 오류 0건으로 컴파일을 확인했다. 두 경고는 검증용 project에 넣었던 `Microsoft.Extensions.Validation` 명시 참조가 shared framework와 중복된다는 내용이었다. 다만 아래 동시성·취소 시나리오는 별도 통합 테스트가 필요한 제안 fixture다.

```csharp
using System.ComponentModel.DataAnnotations;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Validation;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddValidation();
builder.Services.AddPooledDbContextFactory<AppDb>(o =>
    o.UseSqlite("Data Source=users.db"));

var app = builder.Build();
await using (var scope = app.Services.CreateAsyncScope())
{
    var factory = scope.ServiceProvider
        .GetRequiredService<IDbContextFactory<AppDb>>();
    await using var db = await factory.CreateDbContextAsync();
    await db.Database.EnsureCreatedAsync();
}

app.MapPost("/users", async Task<IResult>(
    CreateUser input, IDbContextFactory<AppDb> factory,
    CancellationToken cancellationToken) =>
{
    await using var db = await factory.CreateDbContextAsync(cancellationToken);
    var user = new User { Email = input.Email,
        NormalizedEmail = EmailKey.Normalize(input.Email) };
    db.Users.Add(user);
    try
    {
        await db.SaveChangesAsync(cancellationToken);
        return TypedResults.Created($"/users/{user.Id}", user);
    }
    catch (DbUpdateException ex) when (IsUniqueViolation(ex))
    {
        return TypedResults.Conflict("이미 등록된 이메일입니다.");
    }
});

app.Run();

static bool IsUniqueViolation(Exception ex)
{
    for (Exception? e = ex; e is not null; e = e.InnerException)
        if (e is SqliteException { SqliteExtendedErrorCode: 2067 }) return true;
    return false;
}

public static class EmailKey
{
    public static string Normalize(string value) =>
        value.Trim().ToUpperInvariant();
}

public sealed record CreateUser(
    [property: Required, EmailAddress, UniqueEmail] string Email);

public sealed class UniqueEmailAttribute : AsyncValidationAttribute
{
    protected override ValidationResult? IsValid(
        object? value, ValidationContext context) =>
        throw new InvalidOperationException("비동기 검증 경로를 사용하세요.");

    protected override async Task<ValidationResult?> IsValidAsync(
        object? value, ValidationContext context,
        CancellationToken cancellationToken)
    {
        if (value is not string email || string.IsNullOrWhiteSpace(email))
            return ValidationResult.Success;

        var factory = context.GetRequiredService<IDbContextFactory<AppDb>>();
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var exists = await db.Users.AsNoTracking().AnyAsync(
            x => x.NormalizedEmail == EmailKey.Normalize(email), cancellationToken);
        return exists
            ? new ValidationResult("이미 등록된 이메일입니다.",
                [context.MemberName!])
            : ValidationResult.Success;
    }
}

public sealed class AppDb(DbContextOptions<AppDb> options)
    : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.Entity<User>().HasIndex(x => x.NormalizedEmail).IsUnique();
}

public sealed class User
{
    public int Id { get; set; }
    public required string Email { get; set; }
    public required string NormalizedEmail { get; set; }
}
```

Validator와 handler는 `DbContext`를 공유하지 않는다. Factory에서 context를 만들고 token을 생성·조회·저장까지 전달한다. 동기 `IsValid`은 예외를 던진다.[3][2]

## 두 단계 결과를 API 계약으로 만든다

사전 조회에서 행을 찾으면 handler 전에 validation error가 반환된다. 조회 뒤 다른 요청이 먼저 INSERT하면 `SaveChangesAsync`가 unique constraint에서 실패해 409가 된다. 경로는 달라도 중복 계정은 생성되지 않는다.

모든 `DbUpdateException`을 409로 바꾸면 안 된다. SQLite의 base code 19는 여러 constraint 오류를 포괄하므로 fixture는 unique 위반 extended code 2067만 처리한다.[4] 운영에서는 provider의 **unique violation 식별자와 constraint 이름**을 확인한다. 연결 끊김·timeout·디스크 오류는 장애다. 같은 정규화 정책을 사전 조회와 unique index 양쪽에 적용해야 한다.

## concurrency test는 race를 의도적으로 만든다

첫 INSERT가 빠르면 두 번째 요청은 사전 검증에서 막혀 unique constraint를 시험하지 못한다. 경쟁 창을 강제로 연다.

1. 새 SQLite 파일에서 fixture의 `EnsureCreatedAsync`로 스키마를 만들거나, 별도로 제공한 migration을 적용해 테스트를 시작한다.
2. validator의 `AnyAsync`가 `false`를 읽은 직후 test barrier에서 N개 요청을 모두 대기시킨다.
3. N개를 동시에 풀어 같은 정규화 이메일로 POST한다.
4. 정확히 1개가 201, N-1개가 409인지 확인한다.
5. DB의 해당 `NormalizedEmail` 행이 정확히 1개인지 별도 context로 읽는다.
6. barrier 없는 보조 테스트에서는 나머지가 validation error 또는 409여도 허용하되, 생성 수 1개라는 불변식은 유지한다.

취소 테스트에서는 조회를 지연시키고 request token을 취소해 query 취소, handler 미실행, INSERT 부재를 확인한다. 인프라 예외가 “사용 가능”으로 바뀌지 않는지, 동기 `IsValid`이 `InvalidOperationException`을 내는지도 별도로 검사한다.

## 배포 전 판정표

- SDK 11에서 fixture의 restore·build·test가 통과한다.
- validator마다 독립 context를 사용하고 request cancellation이 DB provider까지 전달된다.
- async validator의 순서나 공유 상태에 의존하지 않는다.
- pending, invalid, faulted를 서로 다른 telemetry와 UI/API 결과로 기록한다.
- unique index가 migration에 포함됐고 실제 운영 DB에서 생성됐는지 읽어 확인한다.
- 강제 race 테스트에서 성공 1건과 최종 행 1건이 일치한다.

.NET 11 비동기 검증은 DB 사전 조회를 pipeline에 넣지만 transaction 경계를 대신하지 않는다. 취소는 자원, 동기 fail-fast는 호출, pending·faulted는 상태, unique constraint는 정합성 계약으로 분리해야 경쟁 조건을 숨기지 않는다.

## Sources

[1] https://devblogs.microsoft.com/dotnet/announcing-dotnet-11
[2] https://learn.microsoft.com/aspnet/core/release-notes/aspnetcore-11
[3] https://learn.microsoft.com/en-us/aspnet/core/fundamentals/validation?view=aspnetcore-11.0
[4] https://www.sqlite.org/rescode.html#constraint_unique
