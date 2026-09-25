---
title: 'Kubernetes 1.37 Volume Hardening: noexec·nosuid·nodev와 emptyDir 권한을 안전하게 도입하는 법'
date: 2026-09-25 08:30:00 +0900
categories: ["개발/인프라"]
description: 'Kubernetes 1.37의 VolumeBindMountOptions와 EmptyDirVolumeMode가 막는 위험과 남기는 한계를 구분하고, alpha gate·runtime capability·version skew를 고려한 rollout과 rollback 절차를 정리한다.'
featured_image: 'https://picsum.photos/seed/kubernetes-137-volume-hardening/1600/900'
tags: [kubernetes, volume, emptydir, noexec, nosuid, nodev, storage-security]
---

![Kubernetes 1.37 Volume Hardening](https://picsum.photos/seed/kubernetes-137-volume-hardening/1600/900)

읽기 전용 root filesystem을 적용한 컨테이너라도 쓰기 가능한 볼륨은 필요할 수 있다. 임시 파일, 캐시, 빌드 산출물, 프로세스 간 교환 데이터가 대표적이다. 문제는 그 writable volume이 단순한 저장 공간을 넘어 새 실행 파일을 놓는 장소, set-user-ID나 set-group-ID 비트가 작동하는 장소, 특수 장치 파일을 해석하는 장소가 될 수 있다는 점이다. 기존 Kubernetes에서는 볼륨이 컨테이너 안으로 bind mount될 때 `noexec`, `nosuid`, `nodev`를 워크로드가 직접 요구할 표준 API가 없었다.[8]

Kubernetes 1.37은 이 간극을 줄이기 위해 두 가지 alpha 기능을 추가했다. `VolumeBindMountOptions`는 개별 `volumeMount`에 Linux bind mount 옵션을 지정하고, `EmptyDirVolumeMode`는 `emptyDir`가 생성될 때 Unix permission mode를 지정한다.[8] 전자는 “컨테이너가 이 mount에서 무엇을 할 수 있는가”를 다루고, 후자는 “공유 디렉터리를 어떤 권한으로 만들 것인가”를 다룬다.

하지만 두 필드를 매니페스트에 추가하는 것만으로 도입이 끝나지는 않는다. 두 기능은 모두 alpha gate 뒤에 있고 API server와 kubelet 양쪽에서 gate를 활성화해야 한다.[8] `bindMountOptions`는 container runtime의 CRI 기능 지원까지 필요하며, `emptyDir.mode`는 version skew 상황에서 조용히 `0777`로 돌아갈 수 있다.[8] 보안 통제라고 선언하려면 설정 의도보다 실제 node placement와 mount 결과를 검증해야 한다.

이 글의 핵심은 기능 소개보다 운영 경계다. 각 옵션이 정확히 무엇을 제한하는지, 무엇까지 막는다고 과장하면 안 되는지, PV의 기존 `mountOptions`와 어떻게 다른지, alpha 기능을 어떤 순서로 canary하고 되돌릴지를 정리한다.

## 먼저 위협 모델을 좁혀야 한다

볼륨 하드닝을 “컨테이너 보안 강화”라는 큰 문장으로만 표현하면 검증할 수 없다. 어떤 writable path에서 어떤 동작을 제한하려는지 먼저 적어야 한다.

예를 들어 `readOnlyRootFilesystem: true`인 애플리케이션도 `/tmp`나 작업 디렉터리로 `emptyDir`를 받을 수 있다. 기존 기본 동작에서는 공격자가 그 writable volume에 파일을 내려받고 실행 비트를 설정한 뒤 직접 실행할 수 있다. Kubernetes 공식 글은 이 상황을 `noexec`가 필요한 대표 사례로 든다.[8]

여러 컨테이너가 하나의 `emptyDir`를 공유할 때는 다른 문제가 생긴다. 기본 `0777` 디렉터리에는 sticky bit가 없으므로, 디렉터리에 접근 가능한 프로세스가 다른 프로세스가 만든 항목을 삭제하거나 이름을 바꿀 수 있다. 파일 내용의 읽기·쓰기는 각 파일의 mode와 소유권에 따라 별도로 결정된다. `/tmp`처럼 여러 사용자가 쓰는 공간이라면 `01777`의 sticky bit를 적용해 삭제와 이름 변경을 파일 소유자, 디렉터리 소유자 또는 `CAP_FOWNER`를 가진 프로세스로 제한할 수 있다. 일반적인 환경에서는 root가 마지막 범주에 해당한다.[8]

따라서 이번 기능은 크게 두 위험을 다룬다.

1. writable mount를 실행이나 권한 변화의 발판으로 사용하는 위험
2. shared writable directory에서 다른 주체의 파일을 훼손하는 위험

둘은 같은 통제가 아니다. `noexec`를 추가해도 파일 소유권과 삭제 규칙은 바뀌지 않는다. `01777`을 설정해도 그 디렉터리에서 바이너리를 직접 실행할 수 있는지는 바뀌지 않는다. 운영 정책은 필요한 옵션과 mode를 조합하되 각각의 효과를 따로 검증해야 한다.

## `VolumeBindMountOptions`가 추가하는 세 가지 Linux 제한

`VolumeBindMountOptions` gate를 활성화하면 컨테이너의 `volumeMounts` 항목 아래 `bindMountOptions`를 지정할 수 있다.[8] Kubernetes 1.37 공식 글이 설명하는 핵심 옵션은 `noexec`, `nosuid`, `nodev`다.

| 옵션 | Linux mount에서 제한하는 동작 | 운영상 확인할 질문 |
|---|---|---|
| `noexec` | 해당 filesystem의 바이너리를 직접 실행하지 못하게 한다.[8] | 애플리케이션이 이 경로에서 helper나 plugin을 실행하는가? |
| `nosuid` | set-user-ID와 set-group-ID 비트가 효력을 내지 못하게 한다.[8] | 정상 동작이 setuid/setgid 파일에 기대는가? |
| `nodev` | character/block special device를 장치로 해석하지 않게 한다.[8] | 이 mount가 실제 장치 파일 사용을 요구하는가? |

세 옵션을 “보안 강화 세트”로 무조건 붙이기보다 볼륨의 역할에 맞게 선택해야 한다. 단순 임시 파일과 캐시를 저장하는 경로라면 세 제한을 모두 적용할 후보가 된다. 반대로 플러그인이나 스크립트를 볼륨으로 전달해 실행하는 애플리케이션은 `noexec`와 충돌할 수 있다. 기능을 켠 뒤 애플리케이션이 시작되지 않는다면 Kubernetes 장애가 아니라 기존 실행 경로가 새 정책에 의해 드러난 것일 수 있다.

### `noexec`는 직접 실행 제한이지 완전한 코드 실행 방지가 아니다

`noexec`의 정확한 의미는 mount된 filesystem에서 바이너리의 **직접 실행을 허용하지 않는 것**이다.[8] 공식 검증 예제에서는 `/tmp`에 executable script를 만든 뒤 `./test.sh`를 실행하면 `Permission denied`가 발생한다.[8]

여기서 “writable volume에 놓인 어떤 코드도 절대 실행할 수 없다”로 확대 해석하면 안 된다. `noexec`가 적용하는 경계는 Linux mount의 실행 허용 여부다. 애플리케이션 자체가 데이터 파일을 명령이나 plugin으로 해석하는 경로, 이미 실행 중인 interpreter에 입력을 전달하는 경로, 다른 writable location을 사용하는 경로까지 이 한 옵션이 모두 통제한다고 볼 수 없다.

따라서 `noexec`는 실행 표면을 줄이는 방어 계층으로 다뤄야 한다. `readOnlyRootFilesystem`, 최소 capability, seccomp, 실행 가능한 도구 축소, network egress 통제와 같은 다른 방어를 제거할 근거가 아니다. 검증도 단순히 `./test.sh` 실패만 확인하지 말고 정상 애플리케이션이 볼륨 데이터를 어떻게 소비하는지 함께 살펴야 한다.

### `nosuid`는 setuid·setgid 효과를 제거한다

`nosuid`는 mount 안의 파일에 set-user-ID 또는 set-group-ID 비트가 있더라도 그 비트가 효력을 내지 못하게 한다.[8] 이 옵션은 writable volume에 놓인 파일이 실행 시 사용자나 그룹 identity를 바꾸는 경로를 줄인다.

다만 `nosuid`를 “모든 privilege escalation 방지”로 표현하면 범위를 넘어선다. 이 옵션이 다루는 것은 해당 mount에서 setuid/setgid 비트가 작동하는 방식이다. 컨테이너에 과도한 Linux capability가 있거나 privileged 설정을 사용하거나 host resource를 넓게 노출한 문제는 별도 통제 대상이다.

도입 전에는 정상 workload가 해당 volume의 setuid/setgid 동작을 실제로 요구하는지 확인해야 한다. 의존성이 없다면 차단하는 편이 안전하지만, 오래된 도구나 특수 runtime이 이를 전제로 한다면 canary에서 시작 실패나 권한 오류로 나타날 수 있다.

### `nodev`는 특수 파일을 장치로 해석하지 않게 한다

`nodev`는 filesystem 안의 character 또는 block special device를 장치로 해석하지 못하게 한다.[8] 일반 애플리케이션의 scratch volume이나 `/tmp`에서는 장치 파일을 사용할 이유가 드물기 때문에 방어 심층화 후보가 된다.

이 역시 device 접근 전체를 해결하는 옵션은 아니다. workload에 어떤 host device를 노출하는지, privileged container인지, device plugin을 사용하는지는 별도의 정책 문제다. `nodev`의 검증 목표는 지정한 volume mount에서 특수 파일이 장치로 취급되지 않는지와 정상 workload가 이 제한에 의존하지 않는지를 확인하는 것이다.

## `EmptyDirVolumeMode`는 shared directory의 시작 권한을 제어한다

기존 `emptyDir`는 디렉터리를 hardcoded `0777` mode로 만들었다.[8] 필요한 권한으로 바꾸려면 init container에서 `chmod`를 실행하는 우회가 가능했지만, 구성은 더 복잡하고 compliance 검증도 어려웠다.[8]

Kubernetes 1.37의 `EmptyDirVolumeMode`는 `emptyDir` 아래 `mode` 필드를 추가한다. 예를 들어 `01777`은 전통적인 Unix `/tmp`처럼 모든 사용자가 디렉터리를 사용할 수 있으면서 sticky bit로 파일 삭제와 이름 변경을 제한한다.[8] 정확한 Linux 규칙상 파일 소유자, 디렉터리 소유자 또는 `CAP_FOWNER`를 가진 프로세스가 해당 항목을 삭제하거나 이름을 바꿀 수 있다. 일반적인 환경에서는 root가 마지막 범주에 해당한다.

여기서 sticky bit의 효과도 정확히 말해야 한다. `01777`은 다른 사용자가 파일 내용을 읽거나 수정할 수 있는지를 파일 자체의 mode와 무관하게 모두 차단하는 옵션이 아니다. 디렉터리 안 항목의 삭제와 이름 변경 규칙을 강화하는 것이 핵심이다. 파일 내용 접근은 파일의 소유권과 mode, 프로세스 identity에 따라 별도로 판단해야 한다.

공식 글은 더 좁은 접근이 필요한 사례로 `0750`도 제시한다. owner와 group에만 접근을 허용하고 others의 접근을 막는 방식이다.[8] 어떤 mode가 적절한지는 공유 모델에 따라 달라진다.

- 여러 UID가 `/tmp`처럼 함께 쓰되 서로의 파일을 삭제하지 못하게 하려면 `01777`을 검토한다.
- 정해진 owner와 group만 사용하는 작업 공간이라면 `0750`처럼 더 좁은 mode를 검토한다.
- 하나의 컨테이너만 쓰는 비공유 scratch라면 필요한 최소 권한을 기준으로 설계한다.
- sidecar와 main container가 공유한다면 두 프로세스의 UID, GID, `fsGroup`을 함께 확인한다.

### `fsGroup`이 있으면 최종 권한이 달라질 수 있다

Pod security context에 `fsGroup`이 설정돼 있으면 적용 과정에서 group ownership과 permission bit가 바뀌어 최종 mode가 `emptyDir.mode`에 지정한 값과 달라질 수 있다.[8] `emptyDir.mode` 자체는 owner나 group identity를 지정하지 않는다. 따라서 manifest의 `mode` 숫자만 리뷰해서 최종 권한을 확정하면 안 된다.

검증 환경에서는 컨테이너 내부에서 실제 mount point의 owner, group, mode를 읽어야 한다. 특히 조직의 admission policy가 `fsGroup`을 자동 주입하거나 chart의 공통 security context가 이를 설정한다면 작성자가 의도한 mode와 실행 결과가 다를 수 있다. `EmptyDirVolumeMode` rollout에는 “API가 값을 받았다”가 아니라 “Pod 안에서 최종 mode가 기대와 같다”는 검사가 필요하다.

## 두 기능을 같은 것으로 묶지 말아야 한다

`VolumeBindMountOptions`와 `EmptyDirVolumeMode`는 같은 storage hardening 목표를 공유하지만 적용 계층과 실패 방식이 다르다.

| 구분 | `VolumeBindMountOptions` | `EmptyDirVolumeMode` |
|---|---|---|
| API 위치 | 컨테이너의 `volumeMounts[].bindMountOptions`[8] | Pod volume의 `emptyDir.mode`[8] |
| 주된 효과 | 컨테이너 내부 bind mount의 VFS 동작 제한 | `emptyDir` 생성 permission 지정 |
| 대상 | image volume을 제외한 여러 volume type[8] | `emptyDir`의 disk, `Memory`, `HugePages` medium[8] |
| runtime 지원 | CRI `mount_options` 지원과 광고 필요[8] | 별도 runtime 지원 불필요[8] |
| 미지원 node 처리 | v1.37에서는 기본 scheduler가 회피하고, 지원하지 않는 runtime의 node에 도달하면 kubelet이 거부[8] | API server gate ON·kubelet gate OFF이면 무시되고 `0777` fallback 가능[8] |
| Windows | 효과 없음[8] | Unix mode가 적용되지 않아 건너뜀[8] |

이 비대칭이 rollout 설계의 핵심이다. `bindMountOptions`는 필요한 runtime capability가 없으면 workload가 실패하는 방향으로 설계돼 있다. 반면 `emptyDir.mode`는 API server와 kubelet의 gate가 어긋나면 workload가 실행되면서도 기대한 permission이 적용되지 않을 수 있다.[8] 가용성 지표만 보면 후자를 놓치기 쉽다.

## PersistentVolume의 `mountOptions`와 다른 계층이다

이름이 비슷해 가장 쉽게 혼동되는 부분이 PersistentVolume의 기존 `mountOptions`다. PV `mountOptions`는 CSI driver를 통해 node의 storage/filesystem 계층에 적용된다. 새 `bindMountOptions`는 container runtime이 컨테이너 안에 만드는 bind mount에 적용된다.[8]

공식 글은 두 옵션이 서로 다른 계층에서 동작하며 충돌하지 않는다고 설명한다.[8] 따라서 PV에 `mountOptions`를 설정했다는 사실만으로 컨테이너의 bind mount에 `noexec`, `nosuid`, `nodev`가 원하는 방식으로 적용된다고 가정해서는 안 된다. 반대로 workload의 `bindMountOptions`가 CSI storage mount의 모든 속성을 대신한다고 봐서도 안 된다.

운영 문서에는 두 층을 분리해 기록하는 편이 좋다.

1. storage team은 StorageClass·PV·CSI 수준의 mount 정책과 driver 호환성을 관리한다.
2. workload team은 개별 container의 `volumeMount`에 필요한 bind mount 제한을 선언한다.
3. platform team은 runtime capability와 node placement를 검증한다.
4. security team은 두 층의 실제 mount 결과가 정책과 일치하는지 검사한다.

하나의 “volume mount options 적용됨” 상태로 합치면 어느 계층에서 정책이 빠졌는지 알기 어렵다.

## 공식 API 모양을 그대로 확인하자

`bindMountOptions`는 `volumes`가 아니라 각 container의 `volumeMounts` 아래에 놓인다. 다음은 Kubernetes 공식 글의 `noexec`, `nosuid` 예제다.[8]

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hardened-bindmount-pod
  namespace: default
spec:
  os:
    name: linux
  containers:
    - name: hardened-app
      image: alpine:latest
      command: ["sleep", "3600"]
      securityContext:
        readOnlyRootFilesystem: true
      volumeMounts:
        - name: temp-storage
          mountPath: /tmp
          bindMountOptions:
            - noexec
            - nosuid
  volumes:
    - name: temp-storage
      emptyDir: {}
```

`emptyDir.mode`는 container의 mount가 아니라 Pod volume 정의에 둔다. 다음 역시 공식 글이 제시한 `01777` 예제다.[8]

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hardened-emptydir-pod
  namespace: default
spec:
  os:
    name: linux
  containers:
    - name: app-container
      image: alpine:latest
      command: ["sleep", "3600"]
      volumeMounts:
        - name: shared-tmp
          mountPath: /tmp
  volumes:
    - name: shared-tmp
      emptyDir:
        mode: 01777
```

예제의 목적은 API 위치와 동작을 보여주는 것이다. production manifest로 옮길 때는 조직의 image pinning, resource, security context, policy 기준을 별도로 적용해야 한다. 또한 alpha gate가 비활성화된 클러스터에 필드를 넣고 결과를 추측하지 말고 API validation과 실제 Pod event를 확인해야 한다.

## alpha gate는 API server와 kubelet에 함께 적용한다

두 기능은 Kubernetes 1.37에서 alpha이며 각각 `VolumeBindMountOptions`, `EmptyDirVolumeMode` feature gate로 제어된다.[8] 사용하려면 API server와 kubelet 모두에서 해당 gate를 활성화해야 한다.[8]

이 요구를 설정 작업 하나로 취급하면 version skew 위험을 놓친다. 제어면이 새 필드를 수락하는지와 각 node의 kubelet이 필드를 집행하는지는 별개의 상태다. node pool이 여러 이미지나 kubelet 설정을 섞어 쓴다면 일부 Pod만 다른 결과를 낼 수 있다.

도입 전 인벤토리에는 최소한 다음 상태가 필요하다.

- API server에서 두 gate가 활성화됐는가.
- 대상 node pool의 모든 kubelet에서 각 gate가 활성화됐는가.
- 각 node의 container runtime이 CRI `mount_options`를 지원하고 `runtimeFeatures`로 광고하는가.
- Windows node가 대상 workload의 scheduling 후보에 포함돼 있지 않은가.
- workload가 사용하는 volume type이 기능 지원 범위에 들어가는가.
- `fsGroup`이나 admission mutation이 최종 `emptyDir` permission을 바꾸는가.

alpha 기능은 이름 그대로 API와 동작이 이후 릴리스에서 바뀔 수 있는 단계다. 전면 표준으로 선언하기보다 제한된 node pool과 workload에서 실험하고, Kubernetes minor upgrade마다 API와 runtime 지원을 다시 확인하는 방식이 안전하다.

## runtime capability와 scheduling 실패를 관측해야 한다

`bindMountOptions`를 실제로 적용하려면 container runtime이 CRI의 `mount_options` field를 지원하고 그 기능을 `runtimeFeatures`로 광고해야 한다.[8] scheduler는 node-declared features를 사용해 지원하지 않는 node에 Pod를 배치하지 않도록 한다.[8]

Kubernetes v1.37에서 gate를 인식하는 kubelet이 runtime 미지원 node에서 해당 Pod를 받으면 옵션을 조용히 무시하지 않고 거부한다.[8] 보안 통제 관점에서는 fail-closed에 가까운 중요한 성질이다. 그러나 pre-v1.37 kubelet은 필드 자체를 알지 못한다. 기본 scheduler의 Node Declared Features 경로를 static Pod나 custom scheduler로 우회해 오래된 kubelet에 도달하면 조용히 기본 mount로 실행될 수 있으므로, 이 보장은 v1.37의 정상 scheduling 경로에 한정해야 한다.

따라서 canary에서는 “mount가 안전한가”뿐 아니라 “충분한 node가 schedulable한가”를 확인해야 한다. autoscaler가 새 node를 추가했지만 runtime feature를 광고하지 않는 경우, 기존 node 교체 뒤 갑자기 배치 가능한 capacity가 줄어드는 경우, mixed-runtime pool에서 특정 node만 후보가 되는 경우를 점검한다.

모니터링에는 다음 신호를 연결할 수 있다.

- `bindMountOptions`를 요구하는 Pod의 Pending 시간과 scheduling event
- kubelet의 unsupported mount option 또는 runtime capability 관련 거부 event
- node image와 container runtime 버전별 배치 성공률
- node 교체·재부팅·autoscaling 직후의 capability 변화
- 예상 후보 node 수와 실제 placement 분포

여기서 목표는 정책이 적용되지 않을 때 조용히 실행되는 경로를 줄이는 것이다. v1.37의 정상 scheduling 경로에서는 fail-closed 때문에 서비스 capacity가 사라질 수 있으므로 rollout 전에 호환 node와 rollback capacity를 확보해야 한다. 동시에 pre-v1.37 node 유입과 scheduler 우회 경로를 차단해야 한다.

## `emptyDir.mode`의 version skew는 더 위험하게 조용하다

`emptyDir.mode`는 container runtime의 별도 지원이 필요하지 않다.[8] 그러나 API server에 gate가 활성화되고 kubelet에는 활성화되지 않은 skew 상황에서는 field가 수락된 뒤 무시되고, kubelet이 `0777`로 fallback한다.[8]

이 경우 Pod는 Running이 될 수 있고 애플리케이션도 정상 응답할 수 있다. 일반적인 availability dashboard에는 이상이 없지만 기대한 sticky bit나 제한된 permission은 존재하지 않는다. 보안 변경의 가장 위험한 실패 형태는 서비스 중단이 아니라 통제가 적용됐다고 믿게 만드는 성공처럼 보이는 상태다.

그러므로 `EmptyDirVolumeMode`의 합격 조건은 API apply 성공이나 Pod Running이 아니다. apply 뒤 GET으로 저장된 Pod spec에 `mode`가 남았는지 확인해야 한다. API server gate가 꺼져 있으면 새 필드가 API 단계에서 제거될 수 있다. 이어 컨테이너 안에서 실제 mount point의 numeric mode, owner, group을 읽고 기대값과 대조한다. 여러 node image가 있다면 각 조합에서 같은 검사를 수행하고, node 교체 뒤에도 재검증해야 한다.

특히 `01777`을 사용하는 shared volume은 단순 mode 출력 외에 실제 행위 테스트가 필요하다. 파일·디렉터리 소유자나 `CAP_FOWNER`를 갖지 않은 서로 다른 UID로 삭제와 이름 변경을 시도해 거부되는지 확인한다. 공식 글도 `ls -ld /tmp`에서 sticky bit를 나타내는 `t`를 확인하고, 다른 사용자의 파일 삭제가 `Operation not permitted`로 실패하는 절차를 제시한다.[8]

## Linux-only 경계를 scheduling 정책으로 고정한다

`noexec`, `nosuid`, `nodev`와 Unix permission mode는 Linux 개념이다. Windows node에서는 `bindMountOptions`가 효과를 내지 않으며 `emptyDir.mode`도 건너뛴다.[8]

따라서 multi-OS cluster에서 같은 workload manifest를 Linux와 Windows에 무차별 배포하면서 동등한 통제를 기대하면 안 된다. 공식 예제처럼 `spec.os.name: linux`를 명시하고, 실제 scheduling 제약도 Linux node로 고정해야 한다.[8] 조직의 템플릿과 policy에서도 “field가 존재하는가”뿐 아니라 Linux workload인지 확인해야 한다.

Windows workload의 storage hardening은 Windows가 제공하는 권한과 실행 통제 모델로 별도 설계해야 한다. 이번 alpha 기능을 Windows 보안 통제의 대체물로 문서화해서는 안 된다.

## volume type별 범위를 확인한다

공식 글에 따르면 `bindMountOptions`는 `emptyDir`, PersistentVolume, CSI volume, projected volume, ConfigMap, Secret 등 폭넓은 volume type에서 동작하며 image volume은 명시적으로 지원하지 않는다.[8] `emptyDir.mode`는 disk-backed 기본 medium뿐 아니라 `Memory`와 `HugePages`에도 적용된다.[8]

넓은 지원 범위가 모든 조합의 무검증 적용을 의미하지는 않는다. read-only data volume에 `noexec`가 필요한지, 애플리케이션이 ConfigMap의 executable script를 실행하는지, Secret volume에서 helper를 실행하는 관행이 있는지에 따라 영향이 다르다. 기존 배포가 volume을 “데이터”가 아니라 “코드 전달 경로”로 사용했다면 `noexec`가 그 의존성을 드러낼 수 있다.

rollout inventory에는 volume 이름만 적지 말고 다음을 기록하는 편이 낫다.

- volume type과 medium
- 각 container의 mount path와 read-only 여부
- 해당 path에서 정상적으로 실행되는 파일이 있는지
- 여러 container가 같은 volume을 공유하는지
- 실행 UID/GID와 `fsGroup`
- 필요한 `bindMountOptions`와 `emptyDir.mode`
- 실제 node/runtime 조합에서 검증한 날짜와 결과

## 안전한 rollout은 gate 활성화보다 앞에서 시작한다

alpha 기능의 rollout을 feature gate 변경부터 시작하면 영향 범위를 통제하기 어렵다. 먼저 workload와 node를 분류하고, 검증 가능한 작은 조합을 만든 뒤 gate를 켜는 편이 낫다.

### 1. 정책 목표를 path 단위로 정의한다

“모든 volume을 hardened로 만든다” 대신 `/tmp`에서는 직접 실행을 막고, shared scratch에서는 서로의 파일 삭제를 막고, 특정 data path에서는 owner/group만 접근하게 한다는 식으로 목표를 적는다. 목표마다 필요한 옵션과 검증 행위가 달라진다.

### 2. 기존 사용 패턴을 조사한다

startup script, plugin, package cache, compiler output처럼 volume에 파일을 쓰고 다시 실행하는 workload를 찾는다. sidecar와 main container의 UID/GID가 다른 shared volume, `fsGroup`을 사용하는 Pod, init container가 `chmod`하는 Pod도 분류한다. 기존 우회 구성을 새 API로 바꿀 때 동작 순서가 달라질 수 있다.

### 3. 전용 canary node pool을 준비한다

Kubernetes 1.37과 gate 설정, runtime 버전을 고정한 작은 Linux node pool을 만든다. `mount_options` capability 광고를 확인하고 일반 workload의 유입을 제한한다. canary workload만 명시적으로 배치해 실패 범위를 줄인다.

### 4. 한 기능씩 검증한다

처음부터 `noexec`, `nosuid`, `nodev`, `01777`, `fsGroup` 변경을 한 번에 적용하지 않는다. 먼저 `bindMountOptions`의 scheduling과 runtime enforcement를 확인하고, 다음으로 `emptyDir.mode`의 최종 permission과 사용자 간 삭제 동작을 확인한다. 변수를 하나씩 추가해야 실패 원인을 좁힐 수 있다.

### 5. 정상 경로와 차단 경로를 함께 시험한다

보안 테스트는 금지한 동작이 실패하는지만 보면 부족하다. 애플리케이션 시작, readiness, 파일 생성과 읽기, sidecar 연동, 재시작, node drain, 재스케줄 뒤에도 정상 동작해야 한다. 동시에 `/tmp/test.sh` 직접 실행, setuid/setgid 효과, special device 해석, 다른 UID가 만든 파일 삭제처럼 차단하려는 행위가 실제로 실패하는지 확인한다.

### 6. node 교체와 autoscaling을 시험한다

기존 canary node에서 한 번 성공한 결과는 새 node의 gate와 runtime capability를 보장하지 않는다. node를 교체하고 pool을 scale out한 뒤 같은 manifest가 같은 node feature와 mount 결과를 얻는지 확인한다. drift가 있으면 workload를 확대하기 전에 node provisioning을 수정한다.

### 7. workload 유형을 단계적으로 넓힌다

먼저 단순 stateless workload의 scratch volume, 다음으로 sidecar와 공유하는 `emptyDir`, 그 뒤 비핵심 PersistentVolume workload처럼 위험도를 높인다. 각 단계에서 일정 기간 기다리는 것보다 배포, restart, drain, node replacement를 의도적으로 실행하는 것이 낫다.

### 8. policy 적용은 검증된 범위만 대상으로 한다

admission policy로 옵션을 강제하려면 해당 workload가 배치될 모든 node가 지원하는지 먼저 확인한다. 준비 전에 전역 강제를 걸면 대규모 scheduling 실패를 만들 수 있다. 반대로 `emptyDir.mode` field 존재 여부만 검사하면 kubelet gate 누락과 `0777` fallback을 놓칠 수 있으므로 실행 결과 점검이 함께 필요하다.

## 검증은 manifest가 아니라 실제 mount에서 끝난다

공식 글은 `noexec` 검증 방법으로 mount에 script를 만들고 실행했을 때 `Permission denied`가 발생하는지 확인하는 예를 제시한다.[8] sticky bit는 `ls -ld`의 `t` 표시와 다른 사용자가 소유한 파일 삭제 실패로 확인한다.[8]

운영 검증은 세 층으로 나누면 명확하다.

### API와 scheduling 층

- API server가 field를 수락하는가.
- Pod가 의도한 Linux canary node에 배치되는가.
- runtime feature가 없는 node가 후보에서 제외되는가.
- kubelet 거부가 발생하면 event에 원인이 드러나는가.

### mount 상태 층

- container 내부 mount에 `noexec`, `nosuid`, `nodev`가 실제 보이는가.
- `emptyDir`의 numeric mode가 기대값과 같은가.
- owner와 group이 예상과 같은가.
- `fsGroup` 적용 뒤 최종 group permission이 정책과 일치하는가.

### 행위 층

- `noexec` mount의 파일 직접 실행이 실패하는가.
- setuid/setgid 비트가 기대한 대로 효력을 내지 않는가.
- special device가 장치로 해석되지 않는가.
- sticky directory에서 파일·디렉터리 소유자나 `CAP_FOWNER`가 아닌 UID의 삭제와 rename이 실패하는가.
- 정상 프로세스의 파일 생성·읽기·정리와 restart가 성공하는가.

검사 결과에는 Pod 이름만 남기지 말고 Kubernetes patch version, kubelet 설정, node image, runtime 이름과 버전, workload image, security context를 함께 기록해야 재현할 수 있다.

## 실패 모드를 미리 분류한다

### Pod가 Pending에 머문다

`bindMountOptions`를 요구하지만 compatible runtime feature를 광고하는 node가 부족할 수 있다. scheduler event와 node-declared features를 확인하고, canary pool의 capacity와 autoscaler가 만드는 node image를 점검한다. 옵션을 급히 제거해 배포를 통과시키기 전에 보안 요구를 포기해도 되는지 승인 절차를 거쳐야 한다.

### kubelet이 Pod를 거부한다

v1.37 kubelet이 runtime 미지원 node에서 Pod를 받으면 `bindMountOptions`를 무시하는 대신 거부한다.[8] event와 kubelet/runtime 로그를 보존하고 placement가 왜 발생했는지 조사한다. pre-v1.37 kubelet이나 static Pod·custom scheduler 우회 여부도 확인한다. node label만 수동으로 맞추는 식의 우회는 runtime capability를 만들지 않는다.

### Pod는 Running인데 `emptyDir`가 `0777`이다

API server에서는 `EmptyDirVolumeMode` gate가 활성화됐지만 kubelet에서는 비활성화된 skew를 먼저 의심해야 한다. 이 경우 API server가 수락한 `mode`를 kubelet이 적용하지 않아 기본 `0777`로 동작할 수 있다.[8] 반대로 API server gate가 비활성화되면 새 Pod의 field가 API 단계에서 제거될 수 있다. `fsGroup`이 group ownership과 permission bit를 바꾼 경우도 함께 확인한다.[8]

### 애플리케이션이 시작되지 않는다

volume에서 startup script, plugin, helper binary를 직접 실행하는 기존 경로가 `noexec`와 충돌했을 수 있다. 옵션을 제거하기 전에 그 실행 경로가 필요한 설계인지, immutable image 안으로 옮길 수 있는지, 예외 volume을 좁게 분리할 수 있는지 검토한다.

### sidecar가 shared file을 정리하지 못한다

`01777`에서 파일 소유자가 달라 삭제나 rename이 차단될 수 있다. 이는 sticky bit의 의도된 효과일 수 있다.[8] shared directory의 정리 책임과 UID/GID 모델을 다시 설계해야 하며, 동작을 복구하려고 무조건 `0777`로 되돌리면 원래의 격리 목표가 사라진다.

### Linux와 Windows에서 결과가 다르다

이번 옵션과 mode는 Linux 개념이며 Windows에서는 적용되지 않는다.[8] scheduling constraint와 `spec.os`를 확인하고 OS별 policy를 분리한다.

## rollback은 통제를 조용히 제거하지 않아야 한다

보안 기능 rollback에서 가장 쉬운 방법은 field를 삭제해 workload를 다시 띄우는 것이다. 하지만 장애를 해결하는 대신 합의한 통제를 없애는 변경일 수 있다. rollback 조건과 승인 주체를 rollout 전에 정해야 한다.

`bindMountOptions`로 인해 scheduling capacity가 부족하거나 정상 실행 경로가 막히면 canary workload를 기존 node pool과 기존 manifest로 되돌릴 수 있다. 이때 옵션 제거 사실을 변경 기록과 보안 예외에 남기고, 어떤 volume에서 어떤 위험이 다시 허용됐는지 명시해야 한다.

`EmptyDirVolumeMode`의 rollback은 더 주의해야 한다. `01777`에서 `0777`로 돌아가면 Pod가 정상 실행돼도 shared directory의 삭제 보호가 사라진다. gate만 끄면 skew 상황과 비슷한 조용한 fallback을 만들 수 있으므로, rollback 뒤에도 실제 mode를 확인하고 노출 기간을 기록해야 한다.

alpha gate 자체를 비활성화하는 경우에는 해당 field를 사용하는 workload가 남아 있는지 먼저 inventory해야 한다. 제어면과 kubelet을 서로 다른 순서로 변경할 때의 동작을 staging에서 확인하고, mixed state가 길게 유지되지 않도록 한다. node 교체 방식으로 설정을 되돌린다면 이전 검증 이미지와 충분한 capacity가 준비돼 있어야 한다.

rollback 후 해야 할 일은 서비스 정상화로 끝나지 않는다.

1. 어떤 option 또는 mode가 어떤 workload 동작과 충돌했는지 기록한다.
2. 지원하지 않은 node/runtime 조합을 scheduling 대상에서 제거한다.
3. 통제가 제거된 path에 임시 보완책이 필요한지 결정한다.
4. 수정된 workload 또는 node image로 같은 차단 테스트를 다시 실행한다.
5. 예외를 자동 만료시키고 재도입 담당자와 기한을 지정한다.

## rollout 체크리스트

### 설계와 범위

- [ ] 보호할 writable path와 위협 동작을 path 단위로 정의했다.
- [ ] `noexec`, `nosuid`, `nodev`, `emptyDir.mode` 각각의 목적을 구분했다.
- [ ] `noexec`를 완전한 code execution 방지로 설명하지 않았다.
- [ ] sticky bit를 파일 내용 접근 전체 통제로 설명하지 않았다.
- [ ] PV `mountOptions`와 container `bindMountOptions`의 계층을 분리했다.
- [ ] image volume이 `bindMountOptions` 지원 대상이 아님을 확인했다.
- [ ] Windows workload를 별도 정책 범위로 분리했다.

### 클러스터와 node 준비

- [ ] API server에서 필요한 alpha gate를 활성화했다.
- [ ] 대상 node의 모든 kubelet에서 같은 gate 상태를 확인했다.
- [ ] container runtime의 CRI `mount_options` 지원과 광고를 확인했다.
- [ ] gate와 runtime 버전을 고정한 Linux canary node pool을 만들었다.
- [ ] node 교체와 autoscaling 뒤에도 capability가 유지되는지 시험했다.
- [ ] incompatible node로 일반화된 label을 붙이는 수동 우회를 금지했다.

### workload 호환성

- [ ] volume에서 script, helper, plugin, binary를 실행하는 경로를 조사했다.
- [ ] init container의 `chmod`와 새 `emptyDir.mode`의 관계를 검토했다.
- [ ] container별 UID/GID와 shared volume 소유권을 기록했다.
- [ ] Pod의 `fsGroup`과 admission mutation을 확인했다.
- [ ] 정상 startup, readiness, 파일 I/O, restart가 성공했다.
- [ ] drain과 재스케줄 뒤에도 같은 결과가 재현됐다.

### 실제 enforcement

- [ ] container 내부에서 mount option을 직접 확인했다.
- [ ] `noexec` mount의 파일 직접 실행이 실패했다.
- [ ] `nosuid`와 `nodev`의 기대 동작을 테스트했다.
- [ ] `emptyDir`의 numeric mode, owner, group을 확인했다.
- [ ] `01777`에서 다른 UID 소유 파일의 삭제와 rename이 실패했다.
- [ ] `0750` 등 제한 mode에서 허용·거부 주체가 예상과 일치했다.
- [ ] Pod Running만으로 보안 적용 성공을 판정하지 않았다.

### 관측과 확대

- [ ] scheduling event와 kubelet 거부 event를 수집한다.
- [ ] compatible node capacity를 대시보드로 확인할 수 있다.
- [ ] node image/runtime 조합별 결과를 기록한다.
- [ ] security test와 application smoke test를 함께 자동화했다.
- [ ] workload 유형별 확대·중단 기준을 사전에 정했다.
- [ ] Kubernetes minor/patch upgrade 뒤 재검증 절차가 있다.

## rollback 체크리스트

- [ ] 검증된 기존 node pool과 충분한 rollback capacity가 있다.
- [ ] canary workload의 신규 배치를 즉시 중단할 수 있다.
- [ ] 이전 manifest와 node image가 재배포 가능한 상태다.
- [ ] option 제거가 다시 허용하는 위험을 승인자에게 명시한다.
- [ ] `emptyDir.mode` rollback 뒤 실제 mode가 무엇인지 확인한다.
- [ ] API server와 kubelet gate가 장시간 mixed state로 남지 않게 한다.
- [ ] `bindMountOptions` 사용 workload를 gate 변경 전에 inventory한다.
- [ ] Pending, kubelet event, runtime log를 사후 분석용으로 보존한다.
- [ ] 실패한 workload·node·runtime 조합을 재배치 대상에서 제외한다.
- [ ] 보안 예외에 소유자, 보완 통제, 만료일을 기록한다.
- [ ] 수정 뒤 정상 경로와 차단 경로를 모두 재시험한다.

## 결론

Kubernetes 1.37의 `VolumeBindMountOptions`와 `EmptyDirVolumeMode`는 writable volume에 남아 있던 중요한 정책 간극을 Kubernetes API 안에서 다룰 수 있게 한다.[8] `noexec`, `nosuid`, `nodev`는 container bind mount의 Linux 동작을 제한하고, `emptyDir.mode`는 `01777`의 sticky bit나 `0750` 같은 시작 permission을 선언할 수 있게 한다.[8]

그렇다고 매니페스트에 세 옵션을 붙이는 것만으로 volume이 안전해지는 것은 아니다. `noexec`는 직접 실행 제한이고, `nosuid`는 setuid/setgid 효과를 제한하며, `nodev`는 special device 해석을 막는다. sticky bit는 shared directory의 삭제와 rename을 통제한다. 각 기능의 좁은 경계를 유지해야 다른 공격 경로와 권한 문제를 가리지 않는다.

운영상 가장 중요한 차이는 실패 방식이다. `bindMountOptions`는 runtime이 CRI `mount_options`를 지원하고 광고해야 하며, v1.37의 기본 scheduler와 kubelet 경로에서는 미지원 node에서 조용히 약화하지 않도록 동작한다.[8] 다만 pre-v1.37 kubelet이나 scheduling 우회는 별도 차단해야 한다. 반면 `emptyDir.mode`는 API server gate ON·kubelet gate OFF이면 field가 무시되고 `0777`로 fallback할 수 있다.[8] 그래서 availability가 아니라 저장된 spec, 실제 mount option과 permission을 검사해야 한다.

안전한 도입은 별도 Linux canary pool, 고정된 kubelet·runtime 조합, path별 위협 모델, 정상·차단 행위 테스트, node 교체 검증에서 시작한다. rollback도 단순 field 삭제가 아니라 어떤 통제가 사라지는지 기록하고 이전의 검증된 node와 manifest로 이동하는 절차여야 한다.

alpha 기능의 성공 기준은 모든 workload에 빠르게 강제하는 것이 아니다. 지원되는 node에만 정확히 배치되고, 기대한 option과 mode가 실제로 적용되며, 정상 애플리케이션 경로를 깨지 않고, 실패 시 통제를 조용히 잃지 않는다는 사실을 반복해서 증명할 수 있어야 한다. 그 검증 체계가 갖춰졌을 때 이번 기능은 read-only root filesystem과 기존 workload 보안을 보완하는 실용적인 한 층이 된다.

## Sources

[8] https://kubernetes.io/blog/2026/09/16/kubernetes-v1-37-hardening-container-storage — Kubernetes v1.37 hardening container storage
