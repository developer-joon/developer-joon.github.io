---
title: 'CodeQL 2.27.3으로 Python 3.15 코드를 스캔할 때: 새 문법보다 custom query 깨짐을 먼저 찾기'
date: 2026-11-03 09:00:08 +0900
categories: ["개발/도구"]
description: 'CodeQL 2.27.3의 Python 3.15 extractor와 JSON data extension을 확인하면서 GitHub Actions CFG와 legacy Completion 변경이 custom query에 미치는 영향을 먼저 검증합니다.'
featured_image: 'https://picsum.photos/seed/news-2026-11-03-github-changelog-2026-11-03-codeql-2-27-3-adds-python-3-15-features-and-json-data-extens/1600/900'
tags: [codeql, python-3-15, static-analysis, custom-query, data-extension, github-actions]
---

![코드가 비친 화면과 여러 갈래로 나뉜 회로](https://picsum.photos/seed/news-2026-11-03-github-changelog-2026-11-03-codeql-2-27-3-adds-python-3-15-features-and-json-data-extens/1600/900)

CodeQL 2.27.3은 Python 3.15의 `match` literal pattern unary plus와 Unicode 17 identifier를 extractor에서 지원하고, 새 `frozendict`·`sentinel` builtin을 모델링한다. Data extension은 기존 YAML 구조와 같은 JSON 문법을 지원하며 `.json` 파일만 JSON으로, 나머지는 계속 YAML로 해석한다.[1]

눈에 띄는 새 문법보다 migration 위험이 큰 곳은 custom query다. 이번 release에서 GitHub Actions CFG가 shared CFG library를 사용하도록 바뀌어 특정 node, edge, basic block boundary에 의존한 query가 깨질 수 있다.[1]

## 먼저 query inventory를 만든다

Default suite만 쓰는 repository와 custom pack을 유지하는 repository의 위험은 다르다. 다음 패턴을 찾는다.

- GitHub Actions CFG node class를 직접 참조하는 query
- Edge 종류나 basic block 수를 고정한 test
- Legacy `Completion` class 사용
- YAML data extension generator와 schema validator
- GitHub Enterprise Server에서 고정한 CLI bundle

Custom pack의 source, lockfile, compiled query test, expected SARIF를 version control에 묶는다. “Database 생성 성공”만으로 query 호환성을 승인하지 않는다.

## Python 3.15 smoke corpus

아래는 **실행하지 않은 제안 fixture**다. 지원 항목별로 최소 source를 만들고 extractor log와 query result를 분리한다.

```python
# unary plus in match literal pattern
match value:
    case +1:
        result = "positive one"

# Unicode 17 identifier와 실제 허용 code point는
# 검토한 Python 3.15 build의 문서에 맞춰 별도 fixture로 고정한다.

frozen = frozendict({"user": source()})
consume(frozen["user"])
marker = sentinel("missing")
```

Fixture가 parse된다는 사실과 taint flow가 기대대로 잡힌다는 사실은 다르다. `frozendict` construction의 data-flow modeling을 확인할 source→sink query를 별도로 둔다.[1]

## YAML과 JSON extension을 동등 비교한다

같은 model을 두 형식으로 작성해 query result를 비교한다. JSON은 JavaScript-style `//`와 `/* ... */` comment도 지원하지만, 일반 JSON parser와의 호환성을 기대해서는 안 된다.[1]

```text
models.yml  -> database A -> result A
models.json -> database B -> result B
```

Model entry 수, accepted/rejected diagnostic, source location, SARIF alert identity를 정규화해 비교한다. 두 파일을 동시에 load해 duplicate model이 생기는 구성도 방지한다. Migration은 YAML 삭제와 JSON 추가를 한 commit에서 하되 generated artifact가 둘을 함께 배포하지 않는지 확인한다.

## GitHub Actions CFG 회귀를 먼저 실패시킨다

대표 workflow에 condition, matrix, reusable workflow call, success/failure edge를 넣는다. 기존 CLI와 2.27.3에서 custom query test를 실행하고 다음을 분류한다.

| 결과 | 의미 | 행동 |
|---|---|---|
| Compile failure | API·class 변경 | 새 shared CFG API로 query 수정 |
| Result diff | node·edge semantics 변화 | expected result를 수동 검토 |
| Same result | fixture 범위에서 호환 | 더 넓은 corpus로 확장 |

Legacy `Completion`에 기대는 query는 새 edge label과 library 계약으로 옮긴다. Expected output을 무조건 재생성하면 실제 탐지 손실을 승인해 버릴 수 있으므로 old·new result의 workflow path를 사람이 검토한다.

## 배포 경계

GitHub.com code scanning은 새 CodeQL version을 자동으로 받지만, 오래된 GHES 환경은 별도 upgrade가 필요할 수 있다.[1] Hosted와 self-managed 결과가 다르면 repository source만 비교하지 말고 CLI version, query pack resolution, extractor environment를 함께 기록한다.

Python fixture 몇 개가 통과해도 Python 3.15 전체 지원이나 모든 custom query 호환성을 증명하지 않는다. 승인 기준은 사용하는 syntax·framework·query pack의 corpus다. 이번 release의 올바른 순서는 새 Python 기능을 자랑하는 데모보다 **custom query compile과 결과 parity를 먼저 확인하고**, 그다음 JSON model과 새 syntax를 단계적으로 추가하는 것이다.

## Sources

[1] https://github.blog/changelog/2026-11-03-codeql-2-27-3-adds-python-3-15-features-and-json-data-extensions/
