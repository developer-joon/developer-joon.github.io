---
title: 'UltraBERT 32K 활용법: 생성형 LLM 없이 긴 문서를 분류하고 검색하기'
date: 2026-10-17 06:10:00 +0900
categories: ["AI 오픈소스"]
description: 'UltraBERT 32K encoder와 UltraBERT-Embed의 역할을 분리하고, 긴 문서의 single-pass 처리와 chunked retrieval을 품질·지연·메모리·비용·보안 조건에서 비교한다.'
featured_image: 'https://picsum.photos/seed/ultrabert-32k-long-document-retrieval/1600/900'
tags: [ultrabert, long-context, encoder, embeddings, retrieval, document-classification, apache-2-0]
---

![UltraBERT 32K의 긴 문서 분류와 검색](https://picsum.photos/seed/ultrabert-32k-long-document-retrieval/1600/900)

긴 문서를 다루는 시스템은 흔히 두 극단으로 흐른다. 첫 번째는 문서를 잘게 잘라 모든 chunk를 embedding하는 방식이다. 두 번째는 문서 전체를 생성형 LLM에 넣고 답을 만들게 하는 방식이다. 둘 사이에는 긴 문서를 한 번 읽고 label이나 vector를 반환하는 bidirectional encoder라는 선택지가 있다.

DMIS Lab은 2026년 10월 14일 **UltraBERT**를 공개했다.[1] 공개 계열은 150M과 380M English encoder, 그리고 150M 기반의 별도 embedding model로 구성된다. Encoder checkpoint는 native 32K context를 지원한다. 발표 자료와 모델은 Apache License 2.0으로 배포된다.

이 글의 핵심은 “32K가 chunking을 없앤다”가 아니다. 긴 입력은 boundary에서 잘리는 정보를 보존할 수 있지만 attention과 padding 비용을 키운다. 반대로 chunking은 짧고 병렬화하기 쉽지만 section 사이 관계를 잃고 index row를 늘린다. **따라서 같은 8K 이상 문서 집합에서 single-32K와 chunked retrieval을 품질, 지연, peak memory, 저장량, 재색인 비용으로 함께 비교해야 한다.**

## 먼저 세 checkpoint를 분리한다

UltraBERT-150M과 UltraBERT-380M은 pre-trained encoder다. 두 checkpoint는 fill-mask와 분류·token classification·question answering용 task class에 로드할 수 있다.[2] 하지만 다운로드하자마자 조직의 분류 label을 아는 완성 classifier는 아니다. 실제 label에 맞춘 fine-tuning이나 최소한 task-specific head 학습이 필요하다.

UltraBERT-Embed-150M은 별도의 contrastive-trained embedding checkpoint다.[1] 이 모델은 query와 document를 768차원 vector로 바꾼다. 검색, 유사도, clustering에 바로 사용할 수 있는 쪽은 일반 encoder가 아니라 Embed checkpoint다. 일반 encoder의 benchmark와 Embed checkpoint의 benchmark를 한 모델의 단일 결과처럼 섞으면 안 된다.

공개된 150M 모델 카드의 실제 parameter 표기는 152M이고 380M 모델은 380M이다.[2] 두 모델은 모두 24 layer를 사용한다. Hidden size는 각각 768과 1,024다. 두 layer의 local attention 뒤 한 layer의 global attention이 오는 패턴을 반복한다.

Local attention window는 각 방향 128 token이다. 모든 세 번째 layer의 global attention이 전체 sequence를 연결한다. Position에는 RoPE를 사용한다. Context length는 32,768 token으로 설정된다.[2]

이 구조는 모든 layer에서 full attention을 수행하는 모델과 비용 곡선이 같지 않다. 그렇다고 sequence length가 공짜가 되는 것도 아니다. Global layer의 attention과 activation은 길이에 따라 커진다. 긴 문서를 무조건 최대 길이로 padding하면 계산과 메모리를 낭비한다.

UltraBERT의 pre-training은 5%와 50% masking sequence를 한 batch 안에서 4:1 비율로 섞고 각 비율에 별도 LM head를 둔다.[3] 5% 경로에는 1.3B teacher의 logit distillation을 적용했다. 50% 경로는 standard MLM loss로 학습했다. 저자들은 낮은 masking ratio가 classification에, 높은 masking ratio가 retrieval에 유리하다는 관측을 이 설계의 근거로 제시한다.

이 training recipe는 deployment API가 두 head를 자동으로 섞는다는 뜻이 아니다. 일반 task fine-tuning은 encoder representation 위에 새 head를 학습한다. Model card는 기본 checkpoint에 encoder와 MLM head가 있고 50% head는 별도 파일로 제공된다고 설명한다.[2] Dense retrieval을 바로 서비스하려면 Embed checkpoint가 더 명확한 출발점이다.

## 32K는 정확히 무엇을 해결하나

Chunking은 문서 경계를 인위적으로 만든다. 계약서의 의무 조항과 예외 조항이 다른 chunk에 있으면 각 vector는 둘의 관계를 직접 표현하지 못할 수 있다. 장애 보고서의 원인과 영향이 멀리 떨어져 있어도 같은 문제가 생긴다. 긴 encoder는 두 구간을 한 입력에서 볼 수 있다.

하지만 32K 입력이 모든 장거리 관계를 완벽하게 학습했다는 뜻은 아니다. Context window는 허용되는 최대 token 수다. 실제 업무 문서의 표, 코드, 각주, 반복 section에서 필요한 관계를 회수하는 능력은 별도 평가해야 한다. Tokenizer가 문서를 32,768 아래로 만든다는 보장도 없다.

UltraBERT 저자들은 LongEmbed passkey test에서 150M과 380M이 32K까지 각 길이에서 99%를 유지했다고 보고한다.[1] 이 수치는 synthetic passkey retrieval에 대한 공급자 연구 결과다. 법률 문서의 다중 예외 해석이나 회의록의 시간적 인과를 99%로 해결했다는 뜻은 아니다. Passkey 결과를 production 정확도로 바꾸려면 실제 문서 fixture가 필요하다.

논문은 UltraBERT-380M이 GLUE 91.0과 BEIR 47.7을 기록했다고 보고한다.[3] 같은 표에서 150M은 GLUE 89.5와 BEIR 45.2다. 저자들은 비교 대상마다 같은 grid search로 task별 fine-tuning을 수행했다고 설명한다. 이는 zero-shot 결과가 아니다.

논문은 두 크기에서 10개 benchmark 중 9개 최고점을 보고한다. 이 역시 저자 평가이며 독립 재현 결과가 아니다. 각 benchmark의 train set과 hyperparameter sweep을 사용한 결과를 조직의 unlabeled document에 그대로 옮길 수 없다. 특히 한국어 문서에는 더 큰 경계가 있다.

UltraBERT 모델 카드는 언어를 English로 명시한다.[2] Pre-training mixture도 영어 web, code, academic, math, instruction text로 설명된다. 한국어 제목의 이 글은 한국어 독자에게 쓰였지만 모델이 한국어 encoder라는 뜻은 아니다. 한국어 문서가 주력이라면 tokenizer 효율, retrieval recall, 분류 calibration을 처음부터 검증해야 한다.

## 설치 전에 선택할 경로

문서 분류라면 `UltraBERT-150M` 또는 `UltraBERT-380M`에 classification head를 붙인다. 검색이라면 `UltraBERT-Embed-150M`을 먼저 평가한다. Masked token 예측은 일반 encoder checkpoint를 사용한다. 세 경로를 하나의 서비스 endpoint로 억지로 합칠 필요는 없다.

공식 안내는 일반 encoder에 `transformers>=5.20`을 권장한다.[1] 더 이른 5.x에서는 `trust_remote_code=True`가 필요할 수 있다. Embed model은 `sentence-transformers>=6.0`과 Transformers 5 이상을 요구하며 custom code trust를 사용한다. Long input에는 FlashAttention 2가 권장되고 SDPA도 지원된다.

다음은 격리 환경을 만드는 예시다. CUDA와 PyTorch wheel은 hardware에 맞게 별도로 고정해야 한다. Production에서는 이 명령 그대로의 floating dependency 대신 lockfile과 image digest를 사용한다.

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install 'transformers>=5.20' 'sentence-transformers>=6.0' \
  accelerate safetensors torch
```

Remote code 실행은 편리하지만 공급망 경계를 넓힌다. Model revision을 고정하지 않으면 다음 다운로드 때 코드가 바뀔 수 있다. 먼저 `snapshot_download`로 검토할 파일만 받는 방식이 낫다. 아래 예제는 실제 다운로드 전에 선택 목록을 출력하는 dry-run이다.

```python
MODEL_FILES = [
    "config.json",
    "model.safetensors",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
]

print({
    "repo_id": "dmis-lab/UltraBERT-150M",
    "revision": "<reviewed-commit-sha>",
    "allow_patterns": MODEL_FILES,
    "dry_run": True,
})
```

검토한 commit SHA를 채운 뒤에만 실제 download를 수행한다. Hugging Face의 mutable `main`은 개발 실험에는 편하지만 production provenance에는 부족하다. Weight가 safetensors여도 remote Python은 별도 검토 대상이다. Cache directory의 권한과 수명도 정해야 한다.

## 긴 문서 분류의 최소 구현

일반 checkpoint는 classification head를 새로 초기화할 수 있다. 다음 코드는 model과 tokenizer를 불러오는 최소 형태다. 이 상태의 출력은 학습 전 random head이므로 실제 분류기로 사용하면 안 된다.

```python
from transformers import AutoModelForSequenceClassification, AutoTokenizer

MODEL_ID = "dmis-lab/UltraBERT-150M"

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForSequenceClassification.from_pretrained(
    MODEL_ID,
    num_labels=3,
)

batch = tokenizer(
    ["A long English document goes here."],
    max_length=32768,
    truncation=True,
    padding=False,
    return_tensors="pt",
)
print(batch["input_ids"].shape)
```

실제 fine-tuning에서는 label definition을 먼저 고정한다. “보안”, “법무”, “운영”처럼 서로 겹치는 label이면 single-label softmax가 맞지 않을 수 있다. Multi-label이면 loss와 threshold calibration을 바꿔야 한다. 긴 문서의 일부만 label 근거라면 token-level evidence나 rationale annotation도 필요하다.

Model card는 classification fine-tuning에 낮은 learning rate를 우선 탐색하라고 권한다.[2] 저자 예시에서 MNLI의 최적값은 150M 1e-5, 380M 8e-6이었다. 다른 encoder가 선호하는 범위보다 낮았다는 공급자 관측이다. 자기 dataset에서 sweep 없이 값을 고정하면 안 된다.

긴 입력 batch는 length bucket으로 묶는다. 1K 문서와 32K 문서를 같은 padded batch에 넣으면 짧은 문서가 31K의 padding 비용을 낸다. Dynamic padding과 token-budget batch를 사용한다. OOM retry가 sample 순서와 gradient accumulation을 바꾸는지도 기록한다.

평가에는 document-level macro F1만 두지 않는다. 길이 bucket별 recall을 본다. 근거가 문서 앞, 중간, 끝에 있을 때 성능을 분리한다. 32K를 넘은 문서에서 truncation 위치도 기록한다. Threshold가 부서별 base rate 변화에 민감한지 확인한다.

## 검색에는 Embed checkpoint를 사용한다

UltraBERT-Embed-150M은 query-side instruction을 사용하고 document는 원문 그대로 embedding한다.[4] 기본 vector dimension은 768이다. Pooling은 CLS token이고 similarity는 cosine으로 설명된다. Query와 document의 입력 형식이 비대칭이므로 prefix 누락은 품질 저하 원인이 된다.

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer(
    "dmis-lab/UltraBERT-Embed-150M",
    trust_remote_code=True,
    model_kwargs={
        "attn_implementation": "sdpa",
        "dtype": "bfloat16",
    },
)

queries = ["Where does the contract define termination notice?"]
documents = [
    "The agreement requires written notice at least thirty days before termination."
]

q = model.encode(
    queries,
    prompt="Instruct: Retrieve passages that answer a contract question\nQuery: ",
    normalize_embeddings=True,
)
d = model.encode(documents, normalize_embeddings=True)
print(model.similarity(q, d))
```

FlashAttention 2를 쓸 수 있으면 long input에서 padding 없는 packing이 유리할 수 있다.[4] 그러나 package를 설치했다고 kernel이 실제 선택됐다고 가정하면 안 된다. 실행 log나 profiler에서 attention backend를 확인한다. SDPA와 FlashAttention 2의 품질은 같더라도 memory와 latency가 다를 수 있다.

Embed model은 500M가량의 weakly supervised text·code pair와 5.7M curated example의 두 단계로 학습됐다고 model card가 설명한다.[4] 두 번째 단계에는 mined hard negative와 최대 32K 입력이 포함됐다. 저자들은 더 큰 embedding model의 distillation 없이 public source data만 사용했다고 밝힌다. 이 학습 이력은 일반 UltraBERT encoder의 pre-training 이력과 다르다.

저자 보고 MTEB English v2 점수는 67.24다.[4] LongEmbed 평균은 79.30이고 passkey 항목은 99.0으로 제시된다. 이 결과는 200M 미만 dense model 비교표의 공급자 평가다. 특정 기업 corpus의 top-k recall이나 latency를 보장하지 않는다.

## Single-32K와 chunked retrieval fixture 만들기

비교는 같은 문서와 같은 query에서 수행해야 한다. Chunk 경로는 문서를 512나 1,024 token 단위로 나눈다. Single 경로는 허용 길이까지 문서 전체를 한 vector로 만든다. 두 경로의 index row 수와 query당 비교 횟수가 달라진다는 점을 비용에 포함한다.

다음 fixture는 tokenizer 기준 chunk를 만들고 두 전략의 산출물 수를 비교한다. 외부 파일을 삭제하거나 network를 호출하지 않는다. 실제 embedding 호출은 `model.encode` 한 줄로 교체할 수 있다.

```python
from dataclasses import dataclass

@dataclass
class Record:
    doc_id: str
    text: str

records = [
    Record(
        "contract-001",
        ("Definitions and obligations. " * 900)
        + "Termination requires thirty days written notice. "
        + ("Schedules and exhibits. " * 900),
    )
]

MAX_DOC_TOKENS = 32768
CHUNK_TOKENS = 1024
OVERLAP_TOKENS = 128

def token_chunks(text, tokenizer, size, overlap):
    ids = tokenizer(text, add_special_tokens=False)["input_ids"]
    step = size - overlap
    return [ids[i:i + size] for i in range(0, len(ids), step)]

for record in records:
    ids = tokenizer(record.text, add_special_tokens=False)["input_ids"]
    single_count = 1 if len(ids) <= MAX_DOC_TOKENS else None
    chunks = token_chunks(record.text, tokenizer, CHUNK_TOKENS, OVERLAP_TOKENS)
    print({
        "doc_id": record.doc_id,
        "tokens": len(ids),
        "single_vector_count": single_count,
        "chunk_vector_count": len(chunks),
    })
```

이 fixture는 품질 평가가 아니라 비용과 boundary를 드러내는 시작점이다. Chunk overlap을 늘리면 boundary 손실은 줄 수 있지만 index가 커진다. Single vector는 index row가 하나지만 여러 주제를 평균화할 수 있다. 문서가 여러 질문에 답하는 경우 coarse document vector만으로는 precise passage를 찾기 어렵다.

따라서 비교군은 둘보다 많아야 한다. 첫 번째는 fixed chunk다. 두 번째는 section-aware chunk다. 세 번째는 single-32K document vector다. 네 번째는 document vector로 후보를 좁힌 뒤 chunk를 재검색하는 hierarchical path다.

Hierarchical path는 긴 encoder와 chunking을 경쟁 관계로만 보지 않는다. Document-level vector는 corpus 후보를 줄인다. Chunk vector는 정확한 passage를 찾는다. Reranker가 필요하면 별도 latency와 비용을 기록한다. 검색 결과의 근거 위치를 사용자에게 보여줄 수 있다는 장점도 있다.

## 무엇을 성능으로 측정할까

검색 품질에는 Recall@k, nDCG@k, MRR을 사용한다. 문서 전체를 찾아야 하는 task와 정확한 passage를 찾아야 하는 task를 분리한다. Ground truth가 section 단위라면 document hit만으로 성공 처리하지 않는다. Negative query와 답이 없는 query도 포함한다.

분류 품질에는 macro F1, class별 precision·recall, calibration error를 사용한다. 긴 문서에서 근거 위치에 따른 결과를 분해한다. 문서 길이, 언어, 표 포함 여부, OCR noise로 slice를 만든다. 평균 하나는 tail failure를 숨긴다.

시스템 지표에는 tokenize time을 포함한다. Encoder forward만 측정하면 긴 문서 전처리 비용이 빠진다. Host-to-device transfer와 pooling도 별도 구간으로 기록한다. End-to-end p50·p95·p99를 함께 본다.

Memory는 `torch.cuda.max_memory_allocated`와 process-level GPU 사용량을 구분한다. Batch별 token 합계와 가장 긴 sequence를 기록한다. Attention backend와 dtype도 함께 남긴다. OOM이 난 trial을 평균에서 버리지 말고 실패율로 보고한다.

Throughput 단위는 documents/s만으로 부족하다. 길이가 다른 문서를 비교할 때 tokens/s도 기록한다. 검색 index build는 vectors/s와 total wall time을 본다. Query serving은 queries/s와 candidate comparisons를 본다.

정확한 비교 표에는 다음 조건이 필요하다.

| 조건 | 기록할 값 |
|---|---|
| 데이터 | 문서 수, token 길이 분포, 언어, 표·코드·OCR 비율 |
| 전략 | chunk size·overlap, section rule, single 최대 길이 |
| 모델 | 일반 encoder/Embed 구분, revision, dtype |
| 실행 | GPU·CPU, backend, batch token budget, concurrency |
| 품질 | task 정의, label·relevance 기준, k, 평가 slice |
| 비용 | index row, vector storage, rebuild time, query compute |

공급자 benchmark와 자체 benchmark는 표에서 분리한다. GLUE와 BEIR은 model family의 잠재력을 보여준다. MTEB와 LongEmbed는 embedding workload의 비교 근거를 준다. 조직의 계약서, ticket, code review에 대한 acceptance는 별도다.

## 32K attention의 비용을 과소평가하지 않는다

Alternating local/global attention은 모든 layer의 quadratic cost를 피하려는 구조다. 그래도 global layer는 sequence가 길어질수록 비싸진다. Activation memory와 attention workspace도 늘어난다. Model parameter 수가 작다고 긴 입력 latency까지 작다는 보장은 없다.

비용은 두 전략에서 다른 위치에 나타난다. Chunking은 embedding 횟수와 vector storage를 늘린다. Single-32K는 한 번의 긴 forward와 큰 peak memory를 낸다. Query 시 chunk index는 비교 candidate가 많아진다. Document vector는 passage precision이 낮아 추가 검색을 부를 수 있다.

다음 식은 실측값을 넣기 위한 비용 분해다.

```text
monthly_retrieval_cost =
    initial_index_compute
  + changed_document_reindex_compute
  + vector_database_storage
  + query_encoding_compute
  + candidate_search_compute
  + optional_reranking_compute
  + failed_job_and_retry_cost
  + engineering_and_oncall
```

Chunk overlap은 storage와 rebuild compute를 동시에 키운다. 문서 하나가 바뀌면 해당 chunk만 갱신할 수 있다는 장점도 있다. Single document vector는 row 수가 작지만 작은 수정에도 전체 문서를 다시 encode한다. 문서 변경 빈도가 높은 corpus에서는 이 차이가 크다.

긴 document를 매 query마다 다시 encode하면 index의 이점을 잃는다. Offline indexing과 online query path를 분리한다. Access control에 따라 사용자별로 보이는 corpus가 다르면 filtering 비용도 측정한다. Vector DB가 filter 후 search인지 search 후 filter인지에 따라 보안과 recall이 달라질 수 있다.

생성형 LLM과 비교할 때도 단위를 맞춘다. Encoder는 label이나 vector를 반환하고 설명문을 생성하지 않는다. 답변 생성이 필요하면 retrieval 뒤 별도 generator 비용이 든다. 반대로 fixed classification만 필요한데 LLM token generation까지 쓰면 불필요한 비용이 생길 수 있다.

## 보안, 라이선스, 데이터 관리

UltraBERT model과 공개 checkpoint는 Apache-2.0으로 표시된다.[1][2] 라이선스가 permissive해도 training data의 모든 원문을 재배포할 권리가 자동으로 생기는 것은 아니다. Model output과 downstream dataset의 권리도 별도 검토가 필요하다. NOTICE와 dependency license를 배포 artifact에 보존한다.

모델 카드는 web-scale data에서 편향을 재생산할 수 있다고 경고한다.[2] 문서 분류가 채용, 금융, 의료 같은 고위험 결정을 좌우하면 human review와 subgroup evaluation이 필요하다. 영어 중심 model을 다른 언어에 적용할 때 오류가 특정 집단에 집중되는지도 본다. 높은 benchmark 평균은 공정성 증거가 아니다.

긴 문서는 secret과 개인정보를 많이 포함할 가능성이 높다. Raw text를 application log에 남기지 않는다. Embedding도 원문을 완전히 익명화한 데이터로 가정하지 않는다. Vector DB의 tenant filter와 backup 권한을 원문 저장소만큼 엄격하게 다룬다.

검색 authorization은 retrieval 뒤에 붙이는 UI filter로 끝나지 않는다. Query 전에 허용 corpus를 제한하는 경로와 반환 전 최종 check를 모두 검증한다. Cache key에 principal과 policy revision을 포함한다. 다른 tenant의 vector가 top-k에 들어왔다가 화면에서만 숨겨지는 구조는 timing과 debug log를 통해 정보를 샐 수 있다.

`trust_remote_code=True`는 model repository의 Python을 process에서 실행한다. Revision을 고정하고 code review를 거친다. Worker에는 필요한 model read 권한 외의 cloud credential을 주지 않는다. Network egress도 최소화한다.

문서 parser가 더 큰 공격 표면일 수 있다. PDF, Office, HTML에서 text를 추출하는 과정은 sandbox에서 수행한다. 외부 link fetch와 macro 실행을 막는다. Extracted text의 크기와 token 상한을 적용한다.

## 흔한 실패 모드

### 32K라는 이름만 믿고 truncation을 놓친다

Tokenizer 결과는 문자 수와 다르다. 영어 외 언어, code, OCR noise는 token 수를 크게 바꿀 수 있다. Ingestion 때 원문 token 수와 잘린 token 수를 기록한다. Truncation이 발생하면 조용히 계속하지 말고 정책에 따라 chunk path로 전환한다.

### 일반 encoder를 embedding model처럼 평균 낸다

가능은 하지만 공식 Embed checkpoint의 contrastive training과 같지 않다. Mean pooling 하나로 저자 benchmark를 재현할 수 없다. 일반 encoder와 Embed model의 결과를 같은 이름으로 저장하지 않는다. Index metadata에 exact model ID와 pooling을 넣는다.

### Query instruction을 빼먹는다

Embed model은 query-side instruction 형식을 사용한다.[4] Document에는 일반적으로 instruction을 붙이지 않는다. 한쪽 형식만 바뀌어도 기존 index와 query가 다른 공간에서 동작할 수 있다. Prefix revision을 schema version으로 관리한다.

### Padding이 비용을 폭발시킨다

길이 500과 30,000 token 문서를 같은 batch에 넣으면 대부분이 padding이 된다. Length bucket과 token-budget batch를 사용한다. FlashAttention packing이 실제 활성화됐는지 확인한다. 평균 문서 수보다 실제 처리 token 수를 지표로 둔다.

### 긴 vector가 세부 passage를 숨긴다

문서 전체를 768차원 하나로 압축하면 작은 예외 조항이 약해질 수 있다. Passage-level ground truth로 실패를 찾는다. Hierarchical retrieval이나 section vector를 대안으로 둔다. Single-32K를 무조건 우승 전략으로 만들지 않는다.

### Chunk benchmark가 불공정하다

Chunk 쪽에만 overlap과 reranker를 주거나 single 쪽에만 instruction tuning을 주면 비교가 흐려진다. 각 전략의 production 후보 구성을 명시한다. 동일한 relevance judgment와 corpus snapshot을 쓴다. Hyperparameter tuning budget도 비슷하게 맞춘다.

### 한국어에서 조용히 품질이 무너진다

Model이 English encoder라는 경계를 무시하면 demo는 되지만 recall이 낮을 수 있다. 한국어와 영어를 분리해 평가한다. 혼합 문서와 code-switch 문서도 별도 slice로 둔다. 한국어 전용 또는 다국어 encoder를 반드시 baseline에 포함한다.

### Fine-tuning 점수를 zero-shot으로 오해한다

논문의 GLUE·BEIR 표는 task별 fine-tuning과 grid search를 포함한다.[2][3] Checkpoint를 내려받아 바로 같은 점수를 얻는 계약이 아니다. Training data와 evaluation protocol을 읽는다. 자체 fine-tuning budget을 비용에 넣는다.

### OOM retry가 latency를 숨긴다

긴 batch 하나가 실패하면 더 작은 batch로 재시도할 수 있다. 성공한 재시도 시간만 기록하면 시스템이 좋아 보인다. 첫 실패의 GPU 시간과 queue delay를 포함한다. 반복 OOM은 admission control 문제로 처리한다.

### Index migration이 섞인다

새 model로 일부 document만 다시 encode하면 한 index에 두 vector space가 공존한다. Model revision별 namespace를 나눈다. Query encoder와 index revision의 equality를 요청 시 검사한다. Full rebuild가 끝난 뒤 alias를 원자적으로 전환한다.

## 도입 순서와 rollout gate

첫 단계는 실제 검색·분류 task를 하나 고르는 것이다. 두 번째 단계는 영어·한국어, 길이, 표·코드, OCR noise가 반영된 고정 dataset을 만든다. 세 번째 단계는 현재 chunk baseline을 그대로 재현한다. 네 번째 단계에서 UltraBERT single-32K를 추가한다.

다섯 번째 단계는 Embed checkpoint와 일반 encoder fine-tune을 분리해 평가한다. 여섯 번째 단계는 section-aware와 hierarchical retrieval을 넣는다. 일곱 번째 단계는 GPU profile과 index 비용을 합친다. 여덟 번째 단계에서만 production shadow traffic을 흘린다.

승인 기준은 평균 benchmark 하나가 아니다. 중요 class의 recall floor를 둔다. 답 없는 query의 false positive 상한을 둔다. p95 latency와 peak memory 상한도 둔다. Reindex 완료 시간과 rollback 시간도 포함한다.

Upgrade gate에서는 model revision, tokenizer, query instruction, pooling, normalization을 함께 비교한다. 어느 하나라도 바뀌면 기존 vector와 호환된다고 가정하지 않는다. Shadow index를 만들고 같은 query set을 재생한다. 결과 overlap과 newly missed critical document를 검토한다.

Rollback은 alias만 이전 index로 돌리면 끝나지 않을 수 있다. Query worker도 이전 encoder와 prefix로 돌아가야 한다. Cache도 revision별로 분리해야 한다. Ingestion backlog가 두 version 사이에서 유실되지 않는지 확인한다.

## 긴 문서 encoder가 맞는 task와 맞지 않는 요구

**적합한 경우**

- 영어 중심의 긴 계약서, 논문, code, ticket을 분류하거나 검색한다.
- 생성 문장보다 label, score, vector가 필요한 task가 명확하다.
- 기존 chunk boundary가 장거리 근거를 자르는 문제가 측정됐다.
- Fine-tuning dataset이나 relevance judgment를 만들 수 있다.
- Attention backend, batching, vector index를 함께 운영할 수 있다.

**부적합한 경우**

- 한국어만 처리하면서 영어 encoder baseline 하나로 결론을 내려 한다.
- 사용자에게 자연어 답변과 citation synthesis까지 한 모델에서 기대한다.
- 32K라는 최대 길이를 무제한 document 처리로 오해한다.
- 일반 encoder와 contrastive Embed checkpoint를 같은 artifact로 취급한다.
- Ground truth 없이 공급자 benchmark만으로 production 품질을 승인한다.

문서가 대부분 512 token 이하면 긴 context의 이점이 작을 수 있다. Corpus가 자주 바뀌고 passage search가 핵심이면 잘 설계된 chunk index가 더 경제적일 수 있다. 다국어 검색에는 검증된 multilingual embedding model이 더 안전한 출발점일 수 있다. 자연어 답변이 필요하면 encoder는 retrieval·classification 앞단으로 쓰고 generator를 분리한다.

## 결론: 32K는 chunking의 대체물이 아니라 비교해야 할 새 기준선이다

UltraBERT는 150M·380M English encoder에 32K context를 제공하고 classification과 retrieval의 masking trade-off를 decoupled head로 다룬다. UltraBERT-Embed-150M은 같은 backbone 위에 contrastive training을 더한 별도 검색 artifact다. 둘의 공개 범위는 Apache-2.0이지만 용도와 benchmark는 같지 않다.

저자 보고 GLUE, BEIR, MTEB, LongEmbed 수치는 강한 출발점이다. 그러나 모두 특정 fine-tuning, dataset, instruction, hardware 조건을 가진 공급자·연구자 측정이다. 한국어 문서, 조직의 label, 자체 corpus access policy, 실제 길이 분포까지 증명하지 않는다.

도입 판단에서는 fixed chunk, section chunk, single-32K, hierarchical retrieval을 같은 fixture에 올려야 한다. 품질만 아니라 tokenize time, peak memory, vector row, rebuild compute, query tail, 실패 재시도를 함께 기록해야 한다. 그 결과 single-32K가 이길 수도 있고 chunking이 이길 수도 있다. 모델 이름보다 boundary 손실과 attention 비용을 같은 표에서 볼 수 있게 만드는 일이 중요하다.

생성형 LLM이 필요 없는 task도 많다. 그러나 encoder가 작고 비생성형이라는 이유만으로 운영이 자동으로 싸고 단순해지는 것은 아니다. 긴 입력의 계산, fine-tuning, index migration, authorization, remote code, 언어 경계를 통제할 때만 그 장점이 실제 비용 절감으로 이어진다.

## Sources

[1] https://huggingface.co/blog/dmis-lab/ultrabert — UltraBERT release and reported results
[2] https://huggingface.co/dmis-lab/UltraBERT-150M — UltraBERT-150M model card, architecture, usage and limitations
[3] https://arxiv.org/abs/2610.15028 — UltraBERT paper
[4] https://huggingface.co/dmis-lab/UltraBERT-Embed-150M — Contrastive embedding checkpoint card and evaluation details
