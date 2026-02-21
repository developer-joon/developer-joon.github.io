---
title: '[Kubernets] Ceph Cluster install with helm'
date: 2022-03-06 00:00:00
description: '쿠버네티스에 가상스토리지를 구성하는 방법에 대해 알아보도록 하겠습니다. 쿠버네티스에서 영구 저장하가 위해선 PV(persistent volume)를 생성해야하는데 싱글노드일땐 호스트 마운트로 사용해도 무관하지만. 멀티노드일땐 가상스토리지는 필수로 사용하는게 좋습니다. 이번에 온프레미스 멀티노드로 쿠버네티스를 구성하였고, ceph(가상스토리지)를 설치를 진행해보았습니다. 공식문서에서 제공하는 가이드 방식은 yaml파일 하나씩 쿠버네티스에 배포하는방식을 설명하지만 helm을 통해 더욱 쉽게 배포를 진행해보겠습니다. '
featured_image: '/images/sauerland-g27a304e52_1920.jpg'
---

![](/images/sauerland-g27a304e52_1920.jpg)

## 소개

쿠버네티스에 가상스토리지를 구성하는 방법에 대해 알아보도록 하겠습니다. 쿠버네티스에서 영구 저장하가 위해선 PV(persistent volume)를 생성해야하는데 싱글노드일땐 호스트 마운트로 사용해도 무관하지만. 멀티노드일땐 가상스토리지는 필수로 사용하는게 좋습니다. 이번에 온프레미스 멀티노드로 쿠버네티스를 구성하였고, ceph(가상스토리지)를 설치를 진행해보았습니다. 공식문서에서 제공하는 가이드 방식은 yaml파일 하나씩 쿠버네티스에 배포하는방식을 설명하지만 helm을 통해 더욱 쉽게 배포를 진행해보겠습니다. 

## Ceph란?

### 간단 정의

- SDS(Software Defined Stroage) 서비스를 제공하는 솔루션 중 하나이다.
- block, file, object를 저장하고 워크로드에 따라 클러스터 노드를 계속 확장 할 수 있는 scale out 형태로 제공한다.
- PB 규모의 리눅스 분산 파일 시스템이다.

## Ceph 배포해보기

### 최소 사양

쿠버네티스 노드 최소 3대 이상 설치 가능합니다.

![Untitled](/images/2022-03-06-Ceph-Cluster-install-with-helm/Untitled.png)

![Untitled](/images/2022-03-06-Ceph-Cluster-install-with-helm/Untitled-1.png)

![Untitled](/images/2022-03-06-Ceph-Cluster-install-with-helm/Untitled-2.png)

### 설치 환경

kubernetes version: 1.23.4

helm version: v3.8.0

마스터 노드 수: 3

워커 노드 수: 3

 

### helm rook-ceph 저장소 추가

아래 명령어를 실행하여 helm에 저장소를 추가합니다.

```bash
$ helm repo add rook-release https://charts.rook.io/release
```

### 저장소에는 아래 두 chart가 존재합니다. (2022.03.06 기준 v1.8.6 최신)

- rook-ceph: 새로운 리소스와 operator 파드가 배포됩니다.
- rook-ceph-cluster: osd, mon 등 ceph 구성이 배포됩니다.

![Untitled](/images/2022-03-06-Ceph-Cluster-install-with-helm/Untitled-3.png)

### rook-ceph 구성

아래 명령어를 실행하여 rook-ceph chart를 다운받습니다.

```bash
$ helm pull rook/rook-ceph --untar
```

helm 구조와 동일하며 values.yaml를 확인합니다.

![Untitled](/images/2022-03-06-Ceph-Cluster-install-with-helm/Untitled-4.png)

### values.yaml 확인

변경할 부분이 있을때 수정하면됩니다. 저는 기본값으로 진행합니다.

```
# Default values for rook-ceph-operator
# This is a YAML-formatted file.
# Declare variables to be passed into your templates.

image:
  prefix: rook
  repository: rook/ceph
  tag: v1.8.6
  pullPolicy: IfNotPresent

crds:
  # Whether the helm chart should create and update the CRDs. If false, the CRDs must be
  # managed independently with deploy/examples/crds.yaml.
  # **WARNING** Only set during first deployment. If later disabled the cluster may be DESTROYED.
  # If the CRDs are deleted in this case, see the disaster recovery guide to restore them.
  # https://rook.github.io/docs/rook/latest/ceph-disaster-recovery.html#restoring-crds-after-deletion
  enabled: true

resources:
  limits:
    cpu: 500m
    memory: 256Mi
  requests:
    cpu: 100m
    memory: 128Mi

nodeSelector: {}
# Constraint rook-ceph-operator Deployment to nodes with label `disktype: ssd`.
# For more info, see https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#nodeselector
#  disktype: ssd

# Tolerations for the rook-ceph-operator to allow it to run on nodes with particular taints
tolerations: []

# Delay to use in node.kubernetes.io/unreachable toleration
unreachableNodeTolerationSeconds: 5

# Whether rook watches its current namespace for CRDs or the entire cluster, defaults to false
currentNamespaceOnly: false

## Annotations to be added to pod
annotations: {}

## The logging level for the operator: ERROR | WARNING | INFO | DEBUG
logLevel: INFO

## If true, create & use RBAC resources
##
rbacEnable: true

## If true, create & use PSP resources
##
pspEnable: true

# Set the priority class for the rook operator deployment if desired
# priorityClassName: class

## Settings for whether to disable the drivers or other daemons if they are not
## needed
csi:
  enableRbdDriver: true
  enableCephfsDriver: true
  enableGrpcMetrics: false
  # Set to true to enable host networking for CSI CephFS and RBD nodeplugins. This may be necessary
  # in some network configurations where the SDN does not provide access to an external cluster or
  # there is significant drop in read/write performance.
  # enableCSIHostNetwork: true
  # set to false to disable deployment of snapshotter container in CephFS provisioner pod.
  enableCephfsSnapshotter: true
  # set to false to disable deployment of snapshotter container in RBD provisioner pod.
  enableRBDSnapshotter: true
  # set to false if the selinux is not enabled or unavailable in cluster nodes.
  enablePluginSelinuxHostMount : false
  # (Optional) set user created priorityclassName for csi plugin pods.
  # pluginPriorityClassName: system-node-critical

  # (Optional) set user created priorityclassName for csi provisioner pods.
  # provisionerPriorityClassName: system-cluster-critical

  # (Optional) policy for modifying a volume's ownership or permissions when the RBD PVC is being mounted.
  # supported values are documented at https://kubernetes-csi.github.io/docs/support-fsgroup.html
  rbdFSGroupPolicy: "ReadWriteOnceWithFSType"

  # (Optional) policy for modifying a volume's ownership or permissions when the CephFS PVC is being mounted.
  # supported values are documented at https://kubernetes-csi.github.io/docs/support-fsgroup.html
  cephFSFSGroupPolicy: "None"

  # OMAP generator generates the omap mapping between the PV name and the RBD image
  # which helps CSI to identify the rbd images for CSI operations.
  # CSI_ENABLE_OMAP_GENERATOR need to be enabled when we are using rbd mirroring feature.
  # By default OMAP generator is disabled and when enabled it will be deployed as a
  # sidecar with CSI provisioner pod, to enable set it to true.
  enableOMAPGenerator: false

  # Set replicas for csi provisioner deployment.
  provisionerReplicas: 2

  # Set logging level for csi containers.
  # Supported values from 0 to 5. 0 for general useful logs, 5 for trace level verbosity.
  #logLevel: 0
  # CSI CephFS plugin daemonset update strategy, supported values are OnDelete and RollingUpdate.
  # Default value is RollingUpdate.
  #rbdPluginUpdateStrategy: OnDelete
  # CSI Rbd plugin daemonset update strategy, supported values are OnDelete and RollingUpdate.
  # Default value is RollingUpdate.
  #cephFSPluginUpdateStrategy: OnDelete
  # Allow starting unsupported ceph-csi image
  allowUnsupportedVersion: false
    # (Optional) CEPH CSI RBD provisioner resource requirement list, Put here list of resource
  # requests and limits you want to apply for provisioner pod
  # csiRBDProvisionerResource: |
  #  - name : csi-provisioner
  #    resource:
  #      requests:
  #        memory: 128Mi
  #        cpu: 100m
  #      limits:
  #        memory: 256Mi
  #        cpu: 200m
  #  - name : csi-resizer
  #    resource:
  #      requests:
  #        memory: 128Mi
  #        cpu: 100m
  #      limits:
  #        memory: 256Mi
  #        cpu: 200m
  #  - name : csi-attacher
  #    resource:
  #      requests:
  #        memory: 128Mi
  #        cpu: 100m
  #      limits:
  #        memory: 256Mi
  #        cpu: 200m
  #  - name : csi-snapshotter
  #    resource:
  #      requests:
  #        memory: 128Mi
  #        cpu: 100m
  #      limits:
  #        memory: 256Mi
  #        cpu: 200m
  #  - name : csi-rbdplugin
  #    resource:
  #      requests:
  #        memory: 512Mi
  #        cpu: 250m
  #      limits:
  #        memory: 1Gi
  #        cpu: 500m
  #  - name : liveness-prometheus
  #    resource:
  #      requests:
  #        memory: 128Mi
  #        cpu: 50m
  #      limits:
  #        memory: 256Mi
  #        cpu: 100m
  # (Optional) CEPH CSI RBD plugin resource requirement list, Put here list of resource
  # requests and limits you want to apply for plugin pod
  # csiRBDPluginResource: |
  #  - name : driver-registrar
  #    resource:
  #      requests:
  #        memory: 128Mi
  #        cpu: 50m
  #      limits:
  #        memory: 256Mi
  #        cpu: 100m
  #  - name : csi-rbdplugin
  #    resource:
  #      requests:
  #        memory: 512Mi
  #        cpu: 250m
  #      limits:
  #        memory: 1Gi
  #        cpu: 500m
  #  - name : liveness-prometheus
  #    resource:
  #      requests:
  #        memory: 128Mi
  #        cpu: 50m
  #      limits:
  #        memory: 256Mi
  #        cpu: 100m
  # (Optional) CEPH CSI CephFS provisioner resource requirement list, Put here list of resource
  # requests and limits you want to apply for provisioner pod
  # csiCephFSProvisionerResource: |
  #  - name : csi-provisioner
  #    resource:
  #      requests:
  #        memory: 128Mi
  #        cpu: 100m
  #      limits:
  #        memory: 256Mi
  #        cpu: 200m
  #  - name : csi-resizer
  #    resource:
  #      requests:
  #        memory: 128Mi
  #        cpu: 100m
  #      limits:
  #        memory: 256Mi
  #        cpu: 200m
  #  - name : csi-attacher
  #    resource:
  #      requests:
  #        memory: 128Mi
  #        cpu: 100m
  #      limits:
  #        memory: 256Mi
  #        cpu: 200m
  #  - name : csi-cephfsplugin
  #    resource:
  #      requests:
  #        memory: 512Mi
  #        cpu: 250m
  #      limits:
  #        memory: 1Gi
  #        cpu: 500m
  #  - name : liveness-prometheus
  #    resource:
  #      requests:
  #        memory: 128Mi
  #        cpu: 50m
  #      limits:
  #        memory: 256Mi
  #        cpu: 100m
  # (Optional) CEPH CSI CephFS plugin resource requirement list, Put here list of resource
  # requests and limits you want to apply for plugin pod
  # csiCephFSPluginResource: |
  #  - name : driver-registrar
  #    resource:
  #      requests:
  #        memory: 128Mi
  #        cpu: 50m
  #      limits:
  #        memory: 256Mi
  #        cpu: 100m
  #  - name : csi-cephfsplugin
  #    resource:
  #      requests:
  #        memory: 512Mi
  #        cpu: 250m
  #      limits:
  #        memory: 1Gi
  #        cpu: 500m
  #  - name : liveness-prometheus
  #    resource:
  #      requests:
  #        memory: 128Mi
  #        cpu: 50m
  #      limits:
  #        memory: 256Mi
  #        cpu: 100m
  # Set provisonerTolerations and provisionerNodeAffinity for provisioner pod.
  # The CSI provisioner would be best to start on the same nodes as other ceph daemons.
  # provisionerTolerations:
  #    - key: key
  #      operator: Exists
  #      effect: NoSchedule
  # provisionerNodeAffinity: key1=value1,value2; key2=value3
  # Set pluginTolerations and pluginNodeAffinity for plugin daemonset pods.
  # The CSI plugins need to be started on all the nodes where the clients need to mount the storage.
  # pluginTolerations:
  #    - key: key
  #      operator: Exists
  #      effect: NoSchedule
  # pluginNodeAffinity: key1=value1,value2; key2=value3
  #cephfsGrpcMetricsPort: 9091
  #cephfsLivenessMetricsPort: 9081
  #rbdGrpcMetricsPort: 9090
  #csiAddonsPort: 9070
  # Enable Ceph Kernel clients on kernel < 4.17. If your kernel does not support quotas for CephFS
  # you may want to disable this setting. However, this will cause an issue during upgrades
  # with the FUSE client. See the upgrade guide: https://rook.io/docs/rook/v1.2/ceph-upgrade.html
  forceCephFSKernelClient: true
  #rbdLivenessMetricsPort: 9080
  #kubeletDirPath: /var/lib/kubelet
  #cephcsi:
    #image: quay.io/cephcsi/cephcsi:v3.5.1
  #registrar:
    #image: k8s.gcr.io/sig-storage/csi-node-driver-registrar:v2.5.0
  #provisioner:
    #image: k8s.gcr.io/sig-storage/csi-provisioner:v3.1.0
  #snapshotter:
    #image: k8s.gcr.io/sig-storage/csi-snapshotter:v5.0.1
  #attacher:
    #image: k8s.gcr.io/sig-storage/csi-attacher:v3.4.0
  #resizer:
    #image: k8s.gcr.io/sig-storage/csi-resizer:v1.4.0
  # Labels to add to the CSI CephFS Deployments and DaemonSets Pods.
  #cephfsPodLabels: "key1=value1,key2=value2"
  # Labels to add to the CSI RBD Deployments and DaemonSets Pods.
  #rbdPodLabels: "key1=value1,key2=value2"
  # Enable the volume replication controller.
  # Before enabling, ensure the Volume Replication CRDs are created.
  # See https://rook.io/docs/rook/latest/ceph-csi-drivers.html#rbd-mirroring
  volumeReplication:
    enabled: false
    #image: "quay.io/csiaddons/volumereplication-operator:v0.3.0"
  # Enable the CSIAddons sidecar.
  csiAddons:
    enabled: false
    #image: "quay.io/csiaddons/k8s-sidecar:v0.2.1"
enableDiscoveryDaemon: false
cephCommandsTimeoutSeconds: "15"

# enable the ability to have multiple Ceph filesystems in the same cluster
# WARNING: Experimental feature in Ceph Releases Octopus (v15)
# https://docs.ceph.com/en/octopus/cephfs/experimental-features/#multiple-file-systems-within-a-ceph-cluster
allowMultipleFilesystems: false

## if true, run rook operator on the host network
# useOperatorHostNetwork: true

## Rook Discover configuration
## toleration: NoSchedule, PreferNoSchedule or NoExecute
## tolerationKey: Set this to the specific key of the taint to tolerate
## tolerations: Array of tolerations in YAML format which will be added to agent deployment
## nodeAffinity: Set to labels of the node to match
# discover:
#   toleration: NoSchedule
#   tolerationKey: key
#   tolerations:
#   - key: key
#     operator: Exists
#     effect: NoSchedule
#   nodeAffinity: key1=value1,value2; key2=value3
#   podLabels: "key1=value1,key2=value2"

# In some situations SELinux relabelling breaks (times out) on large filesystems, and doesn't work with cephfs ReadWriteMany volumes (last relabel wins).
# Disable it here if you have similar issues.
# For more details see https://github.com/rook/rook/issues/2417
enableSelinuxRelabeling: true

# Writing to the hostPath is required for the Ceph mon and osd pods. Given the restricted permissions in OpenShift with SELinux,
# the pod must be running privileged in order to write to the hostPath volume, this must be set to true then.
hostpathRequiresPrivileged: false

# Disable automatic orchestration when new devices are discovered.
disableDeviceHotplug: false

# Blacklist certain disks according to the regex provided.
discoverDaemonUdev:

# imagePullSecrets option allow to pull docker images from private docker registry. Option will be passed to all service accounts.
# imagePullSecrets:
# - name: my-registry-secret

# Whether the OBC provisioner should watch on the operator namespace or not, if not the namespace of the cluster will be used
enableOBCWatchOperatorNamespace: true

admissionController:
  # Set tolerations and nodeAffinity for admission controller pod.
  # The admission controller would be best to start on the same nodes as other ceph daemons.
  # tolerations:
  #    - key: key
  #      operator: Exists
  #      effect: NoSchedule
  # nodeAffinity: key1=value1,value2; key2=value3

monitoring:
  # requires Prometheus to be pre-installed
  # enabling will also create RBAC rules to allow Operator to create ServiceMonitors
  enabled: false
```

### rook-ceph chart 배포

기본적으로 rook-ceph 네임스페이스에 배포를 해야합니다. 

뒤에서 진행할 rook-ceph-cluster chart에선 rook-ceph가 기본값입니다.

```bash
$ helm install --create-namespace --namespace rook-ceph .
```

### 오퍼레이터 확인

status가 running인지 확인합니다. 약 3분이내에 running 됩니다.

```bash
(base) joonwookim@Joonwooui-MacBookPro ~ % kubectl --namespace rook-ceph get pods -l "app=rook-ceph-operator"
NAME                                  READY   STATUS    RESTARTS   AGE
rook-ceph-operator-7bc8964f4d-4ttgh   1/1     Running   0          19s
```

### rook-ceph-cluster 다운

아래 명령어를 실행하여 chart를 다운받습니다.

```bash
helm pull rook-ceph-cluster --untar
```

### value.yaml 확인

개인적인 환경구성으로 변경하시면 됩니다. 노드가 3개라면 기본값으로 진행해도 됩니다.

toolbox enable true로 변경하였습니다. 

region을 ap-northeast-2으로 변경하였습니다.

```
# Default values for a single rook-ceph cluster
# This is a YAML-formatted file.
# Declare variables to be passed into your templates.

# Namespace of the main rook operator
operatorNamespace: rook-ceph

# The metadata.name of the CephCluster CR. The default name is the same as the namespace.
# clusterName: rook-ceph

# Ability to override the kubernetes version used in rendering the helm chart
# kubeVersion: 1.21

# Ability to override ceph.conf
# configOverride: |
#   [global]
#   mon_allow_pool_delete = true
#   osd_pool_default_size = 3
#   osd_pool_default_min_size = 2

# Installs a debugging toolbox deployment
toolbox:
  enabled: **true**
  image: rook/ceph:v1.8.6
  tolerations: []
  affinity: {}
  # Set the priority class for the toolbox if desired
  # priorityClassName: class

monitoring:
  # requires Prometheus to be pre-installed
  # enabling will also create RBAC rules to allow Operator to create ServiceMonitors
  enabled: false
  rulesNamespaceOverride:

# If true, create & use PSP resources. Set this to the same value as the rook-ceph chart.
pspEnable: true

# imagePullSecrets option allow to pull docker images from private docker registry. Option will be passed to all service accounts.
# imagePullSecrets:
# - name: my-registry-secret

# All values below are taken from the CephCluster CRD
# More information can be found at [Ceph Cluster CRD](/Documentation/ceph-cluster-crd.md)
cephClusterSpec:
  cephVersion:
    # The container image used to launch the Ceph daemon pods (mon, mgr, osd, mds, rgw).
    # v15 is octopus, and v16 is pacific.
    # RECOMMENDATION: In production, use a specific version tag instead of the general v16 flag, which pulls the latest release and could result in different
    # versions running within the cluster. See tags available at https://hub.docker.com/r/ceph/ceph/tags/.
    # If you want to be more precise, you can always use a timestamp tag such quay.io/ceph/ceph:v15.2.11-20200419
    # This tag might not contain a new Ceph version, just security fixes from the underlying operating system, which will reduce vulnerabilities
    image: quay.io/ceph/ceph:v16.2.7
    # Whether to allow unsupported versions of Ceph. Currently `octopus` and `pacific` are supported.
    # Future versions such as `pacific` would require this to be set to `true`.
    # Do not set to true in production.
    allowUnsupported: false

  # The path on the host where configuration files will be persisted. Must be specified.
  # Important: if you reinstall the cluster, make sure you delete this directory from each host or else the mons will fail to start on the new cluster.
  # In Minikube, the '/data' directory is configured to persist across reboots. Use "/data/rook" in Minikube environment.
  dataDirHostPath: /var/lib/rook

  # Whether or not upgrade should continue even if a check fails
  # This means Ceph's status could be degraded and we don't recommend upgrading but you might decide otherwise
  # Use at your OWN risk
  # To understand Rook's upgrade process of Ceph, read https://rook.io/docs/rook/latest/ceph-upgrade.html#ceph-version-upgrades
  skipUpgradeChecks: false

  # Whether or not continue if PGs are not clean during an upgrade
  continueUpgradeAfterChecksEvenIfNotHealthy: false

  # WaitTimeoutForHealthyOSDInMinutes defines the time (in minutes) the operator would wait before an OSD can be stopped for upgrade or restart.
  # If the timeout exceeds and OSD is not ok to stop, then the operator would skip upgrade for the current OSD and proceed with the next one
  # if `continueUpgradeAfterChecksEvenIfNotHealthy` is `false`. If `continueUpgradeAfterChecksEvenIfNotHealthy` is `true`, then opertor would
  # continue with the upgrade of an OSD even if its not ok to stop after the timeout. This timeout won't be applied if `skipUpgradeChecks` is `true`.
  # The default wait timeout is 10 minutes.
  waitTimeoutForHealthyOSDInMinutes: 10

  mon:
    # Set the number of mons to be started. Generally recommended to be 3.
    # For highest availability, an odd number of mons should be specified.
    count: 3
    # The mons should be on unique nodes. For production, at least 3 nodes are recommended for this reason.
    # Mons should only be allowed on the same node for test environments where data loss is acceptable.
    allowMultiplePerNode: false

  mgr:
    # When higher availability of the mgr is needed, increase the count to 2.
    # In that case, one mgr will be active and one in standby. When Ceph updates which
    # mgr is active, Rook will update the mgr services to match the active mgr.
    count: 1
    modules:
      # Several modules should not need to be included in this list. The "dashboard" and "monitoring" modules
      # are already enabled by other settings in the cluster CR.
      - name: pg_autoscaler
        enabled: true

  # enable the ceph dashboard for viewing cluster status
  dashboard:
    enabled: true
    # serve the dashboard under a subpath (useful when you are accessing the dashboard via a reverse proxy)
    # urlPrefix: /ceph-dashboard
    # serve the dashboard at the given port.
    # port: 8443
    # serve the dashboard using SSL
    ssl: true

  # Network configuration, see: https://github.com/rook/rook/blob/master/Documentation/ceph-cluster-crd.md#network-configuration-settings
  # network:
  #   # enable host networking
  #   provider: host
  #   # EXPERIMENTAL: enable the Multus network provider
  #   provider: multus
  #   selectors:
  #     # The selector keys are required to be `public` and `cluster`.
  #     # Based on the configuration, the operator will do the following:
  #     #   1. if only the `public` selector key is specified both public_network and cluster_network Ceph settings will listen on that interface
  #     #   2. if both `public` and `cluster` selector keys are specified the first one will point to 'public_network' flag and the second one to 'cluster_network'
  #     #
  #     # In order to work, each selector value must match a NetworkAttachmentDefinition object in Multus
  #     #
  #     # public: public-conf --> NetworkAttachmentDefinition object name in Multus
  #     # cluster: cluster-conf --> NetworkAttachmentDefinition object name in Multus
  #   # Provide internet protocol version. IPv6, IPv4 or empty string are valid options. Empty string would mean IPv4
  #   ipFamily: "IPv6"
  #   # Ceph daemons to listen on both IPv4 and Ipv6 networks
  #   dualStack: false

  # enable the crash collector for ceph daemon crash collection
  crashCollector:
    disable: false
    # Uncomment daysToRetain to prune ceph crash entries older than the
    # specified number of days.
    # daysToRetain: 30

  # enable log collector, daemons will log on files and rotate
  # logCollector:
  #   enabled: true
  #   periodicity: 24h # SUFFIX may be 'h' for hours or 'd' for days.

  # automate [data cleanup process](https://github.com/rook/rook/blob/master/Documentation/ceph-teardown.md#delete-the-data-on-hosts) in cluster destruction.
  cleanupPolicy:
    # Since cluster cleanup is destructive to data, confirmation is required.
    # To destroy all Rook data on hosts during uninstall, confirmation must be set to "yes-really-destroy-data".
    # This value should only be set when the cluster is about to be deleted. After the confirmation is set,
    # Rook will immediately stop configuring the cluster and only wait for the delete command.
    # If the empty string is set, Rook will not destroy any data on hosts during uninstall.
    confirmation: ""
    # sanitizeDisks represents settings for sanitizing OSD disks on cluster deletion
    sanitizeDisks:
      # method indicates if the entire disk should be sanitized or simply ceph's metadata
      # in both case, re-install is possible
      # possible choices are 'complete' or 'quick' (default)
      method: quick
      # dataSource indicate where to get random bytes from to write on the disk
      # possible choices are 'zero' (default) or 'random'
      # using random sources will consume entropy from the system and will take much more time then the zero source
      dataSource: zero
      # iteration overwrite N times instead of the default (1)
      # takes an integer value
      iteration: 1
    # allowUninstallWithVolumes defines how the uninstall should be performed
    # If set to true, cephCluster deletion does not wait for the PVs to be deleted.
    allowUninstallWithVolumes: false

  # To control where various services will be scheduled by kubernetes, use the placement configuration sections below.
  # The example under 'all' would have all services scheduled on kubernetes nodes labeled with 'role=storage-node' and
  # tolerate taints with a key of 'storage-node'.
  # placement:
  #   all:
  #     nodeAffinity:
  #       requiredDuringSchedulingIgnoredDuringExecution:
  #         nodeSelectorTerms:
  #           - matchExpressions:
  #             - key: role
  #               operator: In
  #             values:
  #             - storage-node
  #     podAffinity:
  #     podAntiAffinity:
  #     topologySpreadConstraints:
  #     tolerations:
  #     - key: storage-node
  #       operator: Exists
  #   # The above placement information can also be specified for mon, osd, and mgr components
  #   mon:
  #   # Monitor deployments may contain an anti-affinity rule for avoiding monitor
  #   # collocation on the same node. This is a required rule when host network is used
  #   # or when AllowMultiplePerNode is false. Otherwise this anti-affinity rule is a
  #   # preferred rule with weight: 50.
  #   osd:
  #   mgr:
  #   cleanup:

  # annotations:
  #   all:
  #   mon:
  #   osd:
  #   cleanup:
  #   prepareosd:
  #   # If no mgr annotations are set, prometheus scrape annotations will be set by default.
  #   mgr:

  # labels:
  #   all:
  #   mon:
  #   osd:
  #   cleanup:
  #   mgr:
  #   prepareosd:
  #   # monitoring is a list of key-value pairs. It is injected into all the monitoring resources created by operator.
  #   # These labels can be passed as LabelSelector to Prometheus
  #   monitoring:

  # resources:
  #   # The requests and limits set here, allow the mgr pod to use half of one CPU core and 1 gigabyte of memory
  #   mgr:
  #     limits:
  #       cpu: "500m"
  #       memory: "1024Mi"
  #     requests:
  #       cpu: "500m"
  #       memory: "1024Mi"
  #   # The above example requests/limits can also be added to the other components
  #   mon:
  #   osd:
  #   prepareosd:
  #   mgr-sidecar:
  #   crashcollector:
  #   logcollector:
  #   cleanup:

  # The option to automatically remove OSDs that are out and are safe to destroy.
  removeOSDsIfOutAndSafeToRemove: false

  # priority classes to apply to ceph resources
  # priorityClassNames:
  #   all: rook-ceph-default-priority-class
  #   mon: rook-ceph-mon-priority-class
  #   osd: rook-ceph-osd-priority-class
  #   mgr: rook-ceph-mgr-priority-class
  #   crashcollector: rook-ceph-crashcollector-priority-class

  storage: # cluster level storage configuration and selection
    useAllNodes: true
    useAllDevices: true
    # deviceFilter:
    # config:
    #   crushRoot: "custom-root" # specify a non-default root label for the CRUSH map
    #   metadataDevice: "md0" # specify a non-rotational storage so ceph-volume will use it as block db device of bluestore.
    #   databaseSizeMB: "1024" # uncomment if the disks are smaller than 100 GB
    #   journalSizeMB: "1024"  # uncomment if the disks are 20 GB or smaller
    #   osdsPerDevice: "1" # this value can be overridden at the node or device level
    #   encryptedDevice: "true" # the default value for this option is "false"
    # # Individual nodes and their config can be specified as well, but 'useAllNodes' above must be set to false. Then, only the named
    # # nodes below will be used as storage resources.  Each node's 'name' field should match their 'kubernetes.io/hostname' label.
    # nodes:
    #   - name: "172.17.4.201"
    #     devices: # specific devices to use for storage can be specified for each node
    #       - name: "sdb"
    #       - name: "nvme01" # multiple osds can be created on high performance devices
    #         config:
    #           osdsPerDevice: "5"
    #       - name: "/dev/disk/by-id/ata-ST4000DM004-XXXX" # devices can be specified using full udev paths
    #     config: # configuration can be specified at the node level which overrides the cluster level config
    #   - name: "172.17.4.301"
    #     deviceFilter: "^sd."

  # The section for configuring management of daemon disruptions during upgrade or fencing.
  disruptionManagement:
    # If true, the operator will create and manage PodDisruptionBudgets for OSD, Mon, RGW, and MDS daemons. OSD PDBs are managed dynamically
    # via the strategy outlined in the [design](https://github.com/rook/rook/blob/master/design/ceph/ceph-managed-disruptionbudgets.md). The operator will
    # block eviction of OSDs by default and unblock them safely when drains are detected.
    managePodBudgets: true
    # A duration in minutes that determines how long an entire failureDomain like `region/zone/host` will be held in `noout` (in addition to the
    # default DOWN/OUT interval) when it is draining. This is only relevant when  `managePodBudgets` is `true`. The default value is `30` minutes.
    osdMaintenanceTimeout: 30
    # A duration in minutes that the operator will wait for the placement groups to become healthy (active+clean) after a drain was completed and OSDs came back up.
    # Operator will continue with the next drain if the timeout exceeds. It only works if `managePodBudgets` is `true`.
    # No values or 0 means that the operator will wait until the placement groups are healthy before unblocking the next drain.
    pgHealthCheckTimeout: 0
    # If true, the operator will create and manage MachineDisruptionBudgets to ensure OSDs are only fenced when the cluster is healthy.
    # Only available on OpenShift.
    manageMachineDisruptionBudgets: false
    # Namespace in which to watch for the MachineDisruptionBudgets.
    machineDisruptionBudgetNamespace: openshift-machine-api

  # Configure the healthcheck and liveness probes for ceph pods.
  # Valid values for daemons are 'mon', 'osd', 'status'
  healthCheck:
    daemonHealth:
      mon:
        disabled: false
        interval: 45s
      osd:
        disabled: false
        interval: 60s
      status:
        disabled: false
        interval: 60s
    # Change pod liveness probe, it works for all mon, mgr, and osd pods.
    livenessProbe:
      mon:
        disabled: false
      mgr:
        disabled: false
      osd:
        disabled: false

ingress:
  dashboard: {}
    # annotations:
    #   kubernetes.io/ingress.class: nginx
    #   external-dns.alpha.kubernetes.io/hostname: example.com
    #   nginx.ingress.kubernetes.io/rewrite-target: /ceph-dashboard/$2
    # host:
    #   name: example.com
    #   path: "/ceph-dashboard(/|$)(.*)"
    # tls:

cephBlockPools:
  - name: ceph-blockpool
    # see https://github.com/rook/rook/blob/master/Documentation/ceph-pool-crd.md#spec for available configuration
    spec:
      failureDomain: host
      replicated:
        size: 3
    storageClass:
      enabled: true
      name: ceph-block
      isDefault: true
      reclaimPolicy: Delete
      allowVolumeExpansion: true
      mountOptions: []
      # see https://github.com/rook/rook/blob/master/Documentation/ceph-block.md#provision-storage for available configuration
      parameters:
        # (optional) mapOptions is a comma-separated list of map options.
        # For krbd options refer
        # https://docs.ceph.com/docs/master/man/8/rbd/#kernel-rbd-krbd-options
        # For nbd options refer
        # https://docs.ceph.com/docs/master/man/8/rbd-nbd/#options
        # mapOptions: lock_on_read,queue_depth=1024

        # (optional) unmapOptions is a comma-separated list of unmap options.
        # For krbd options refer
        # https://docs.ceph.com/docs/master/man/8/rbd/#kernel-rbd-krbd-options
        # For nbd options refer
        # https://docs.ceph.com/docs/master/man/8/rbd-nbd/#options
        # unmapOptions: force

        # RBD image format. Defaults to "2".
        imageFormat: "2"
        # RBD image features. Available for imageFormat: "2". CSI RBD currently supports only `layering` feature.
        imageFeatures: layering
        # The secrets contain Ceph admin credentials.
        csi.storage.k8s.io/provisioner-secret-name: rook-csi-rbd-provisioner
        csi.storage.k8s.io/provisioner-secret-namespace: rook-ceph
        csi.storage.k8s.io/controller-expand-secret-name: rook-csi-rbd-provisioner
        csi.storage.k8s.io/controller-expand-secret-namespace: rook-ceph
        csi.storage.k8s.io/node-stage-secret-name: rook-csi-rbd-node
        csi.storage.k8s.io/node-stage-secret-namespace: rook-ceph
        # Specify the filesystem type of the volume. If not specified, csi-provisioner
        # will set default as `ext4`. Note that `xfs` is not recommended due to potential deadlock
        # in hyperconverged settings where the volume is mounted on the same node as the osds.
        csi.storage.k8s.io/fstype: ext4

cephFileSystems:
  - name: ceph-filesystem
    # see https://github.com/rook/rook/blob/master/Documentation/ceph-filesystem-crd.md#filesystem-settings for available configuration
    spec:
      metadataPool:
        replicated:
          size: 3
      dataPools:
        - failureDomain: host
          replicated:
            size: 3
      metadataServer:
        activeCount: 1
        activeStandby: true
    storageClass:
      enabled: true
      isDefault: false
      name: ceph-filesystem
      reclaimPolicy: Delete
      allowVolumeExpansion: true
      mountOptions: []
      # see https://github.com/rook/rook/blob/master/Documentation/ceph-filesystem.md#provision-storage for available configuration
      parameters:
        # The secrets contain Ceph admin credentials.
        csi.storage.k8s.io/provisioner-secret-name: rook-csi-cephfs-provisioner
        csi.storage.k8s.io/provisioner-secret-namespace: rook-ceph
        csi.storage.k8s.io/controller-expand-secret-name: rook-csi-cephfs-provisioner
        csi.storage.k8s.io/controller-expand-secret-namespace: rook-ceph
        csi.storage.k8s.io/node-stage-secret-name: rook-csi-cephfs-node
        csi.storage.k8s.io/node-stage-secret-namespace: rook-ceph
        # Specify the filesystem type of the volume. If not specified, csi-provisioner
        # will set default as `ext4`. Note that `xfs` is not recommended due to potential deadlock
        # in hyperconverged settings where the volume is mounted on the same node as the osds.
        csi.storage.k8s.io/fstype: ext4

cephFileSystemVolumeSnapshotClass:
  enabled: false
  name: ceph-filesystem
  isDefault: true
  deletionPolicy: Delete
  annotations: {}
  labels: {}
  # see https://rook.io/docs/rook/latest/ceph-csi-snapshot.html#cephfs-snapshots for available configuration
  parameters: {}

cephBlockPoolsVolumeSnapshotClass:
  enabled: false
  name: ceph-block
  isDefault: false
  deletionPolicy: Delete
  annotations: {}
  labels: {}
  # see https://rook.io/docs/rook/latest/ceph-csi-snapshot.html#rbd-snapshots for available configuration
  parameters: {}

cephObjectStores:
  - name: ceph-objectstore
    # see https://github.com/rook/rook/blob/master/Documentation/ceph-object-store-crd.md#object-store-settings for available configuration
    spec:
      metadataPool:
        failureDomain: host
        replicated:
          size: 3
      dataPool:
        failureDomain: host
        erasureCoded:
          dataChunks: 2
          codingChunks: 1
      preservePoolsOnDelete: true
      gateway:
        port: 80
        # securePort: 443
        # sslCertificateRef:
        instances: 1
      healthCheck:
        bucket:
          interval: 60s
    storageClass:
      enabled: true
      name: ceph-bucket
      reclaimPolicy: Delete
      # see https://github.com/rook/rook/blob/master/Documentation/ceph-object-bucket-claim.md#storageclass for available configuration
      parameters:
        # note: objectStoreNamespace and objectStoreName are configured by the chart
        region: ap-northeast-2
```

### rook-ceph-cluster release

아래 명령어로 실치를 진행합니다.

```
$ helm install --create-namespace --namespace rook-ceph .
```

### operator 파드 로그

로그를 모니터링 하며 에러가 발생하는지 기다립니다.

```bash
$ kubectl --namespace rook-ceph logs -f -l "app=rook-ceph-operator"
```

output

```
(base) joonwookim@Joonwooui-MacBookPro ~ % kubectl --namespace rook-ceph logs -f -l "app=rook-ceph-operator"
2022-03-05 02:03:36.224200 I | op-bucket-prov: ceph bucket provisioner launched watching for provisioner "rook-ceph.ceph.rook.io/bucket"
2022-03-05 02:03:36.226129 I | op-bucket-prov: successfully reconciled bucket provisioner
I0305 02:03:36.226216       1 manager.go:135] objectbucket.io/provisioner-manager "msg"="starting provisioner"  "name"="rook-ceph.ceph.rook.io/bucket"
2022-03-05 02:03:36.442504 I | op-k8sutil: CSI_RBD_FSGROUPPOLICY="ReadWriteOnceWithFSType" (configmap)
2022-03-05 02:03:36.453278 I | ceph-csi: CSIDriver object updated for driver "rook-ceph.rbd.csi.ceph.com"
2022-03-05 02:03:36.453330 I | op-k8sutil: CSI_CEPHFS_FSGROUPPOLICY="None" (configmap)
2022-03-05 02:03:36.462147 I | ceph-csi: CSIDriver object updated for driver "rook-ceph.cephfs.csi.ceph.com"
2022-03-05 02:03:51.747049 E | clusterdisruption-controller: failed to check cluster health: failed to get status. . timed out: exit status 1
2022-03-05 02:03:55.839715 I | op-mon: mons running: [a]
2022-03-05 02:04:07.027358 E | clusterdisruption-controller: failed to check cluster health: failed to get status. . timed out: exit status 1
2022-03-05 02:04:16.146028 I | op-mon: mons running: [a]
2022-03-05 02:04:22.437825 E | clusterdisruption-controller: failed to check cluster health: failed to get status. . timed out: exit status 1
2022-03-05 02:04:25.750236 I | op-mon: Monitors in quorum: [a]
2022-03-05 02:04:25.750272 I | op-mon: mons created: 1
2022-03-05 02:04:26.528449 I | clusterdisruption-controller: all PGs are active+clean. Restoring default OSD pdb settings
2022-03-05 02:04:26.528488 I | clusterdisruption-controller: creating the default pdb "rook-ceph-osd" with maxUnavailable=1 for all osd
2022-03-05 02:04:26.546093 I | clusterdisruption-controller: reconciling osd pdb reconciler as the allowed disruptions in default pdb is 0
2022-03-05 02:04:27.640106 I | op-mon: waiting for mon quorum with [a]
2022-03-05 02:04:27.655392 I | op-mon: mons running: [a]
2022-03-05 02:04:28.425217 I | clusterdisruption-controller: reconciling osd pdb reconciler as the allowed disruptions in default pdb is 0
2022-03-05 02:04:29.530958 I | op-mon: Monitors in quorum: [a]
2022-03-05 02:04:29.531001 I | op-config: setting "global"="mon allow pool delete"="true" option to the mon configuration database
2022-03-05 02:04:30.254069 I | clusterdisruption-controller: reconciling osd pdb reconciler as the allowed disruptions in default pdb is 0
2022-03-05 02:04:30.656369 I | op-config: successfully set "global"="mon allow pool delete"="true" option to the mon configuration database
2022-03-05 02:04:30.656420 I | op-config: setting "global"="mon cluster log file"="" option to the mon configuration database
2022-03-05 02:04:31.425251 I | op-config: successfully set "global"="mon cluster log file"="" option to the mon configuration database
2022-03-05 02:04:31.425291 I | op-config: setting "global"="mon allow pool size one"="true" option to the mon configuration database
2022-03-05 02:04:32.064917 I | op-config: successfully set "global"="mon allow pool size one"="true" option to the mon configuration database
2022-03-05 02:04:32.064953 I | op-config: setting "global"="osd scrub auto repair"="true" option to the mon configuration database
2022-03-05 02:04:32.758480 I | op-config: successfully set "global"="osd scrub auto repair"="true" option to the mon configuration database
2022-03-05 02:04:32.758526 I | op-config: setting "global"="log to file"="false" option to the mon configuration database
2022-03-05 02:04:33.458363 I | op-config: successfully set "global"="log to file"="false" option to the mon configuration database
2022-03-05 02:04:33.458393 I | op-config: setting "global"="rbd_default_features"="3" option to the mon configuration database
2022-03-05 02:04:34.145570 I | op-config: successfully set "global"="rbd_default_features"="3" option to the mon configuration database
2022-03-05 02:04:34.145610 I | op-config: deleting "log file" option from the mon configuration database
2022-03-05 02:04:34.839478 I | op-config: successfully deleted "log file" option from the mon configuration database
2022-03-05 02:04:34.839518 I | op-mon: creating mon b
2022-03-05 02:04:34.892213 I | op-mon: mon "a" endpoint is [v2:10.105.8.75:3300,v1:10.105.8.75:6789]
2022-03-05 02:04:34.915903 I | op-mon: mon "b" endpoint is [v2:10.109.89.77:3300,v1:10.109.89.77:6789]
2022-03-05 02:04:34.935815 I | op-mon: saved mon endpoints to config map map[csi-cluster-config-json:[{"clusterID":"rook-ceph","monitors":["10.105.8.75:6789","10.109.89.77:6789"]}] data:a=10.105.8.75:6789,b=10.109.89.77:6789 mapping:{"node":{"a":{"Name":"k5","Hostname":"k5","Address":"10.0.0.15"},"b":{"Name":"k6","Hostname":"k6","Address":"10.0.0.16"},"c":{"Name":"k4","Hostname":"k4","Address":"10.0.0.14"}}} maxMonId:0]
2022-03-05 02:04:35.044972 I | cephclient: writing config file /var/lib/rook/rook-ceph/rook-ceph.config
2022-03-05 02:04:35.045270 I | cephclient: generated admin config in /var/lib/rook/rook-ceph
2022-03-05 02:04:35.457913 I | op-mon: 1 of 2 expected mon deployments exist. creating new deployment(s).
2022-03-05 02:04:35.465518 I | op-mon: deployment for mon rook-ceph-mon-a already exists. updating if needed
2022-03-05 02:04:35.489264 I | op-k8sutil: deployment "rook-ceph-mon-a" did not change, nothing to update
2022-03-05 02:04:35.643588 I | op-mon: updating maxMonID from 0 to 1 after committing mon "b"
2022-03-05 02:04:36.446549 I | op-mon: saved mon endpoints to config map map[csi-cluster-config-json:[{"clusterID":"rook-ceph","monitors":["10.105.8.75:6789","10.109.89.77:6789"]}] data:a=10.105.8.75:6789,b=10.109.89.77:6789 mapping:{"node":{"a":{"Name":"k5","Hostname":"k5","Address":"10.0.0.15"},"b":{"Name":"k6","Hostname":"k6","Address":"10.0.0.16"},"c":{"Name":"k4","Hostname":"k4","Address":"10.0.0.14"}}} maxMonId:1]
2022-03-05 02:04:36.446595 I | op-mon: waiting for mon quorum with [a b]
2022-03-05 02:04:36.850374 I | op-mon: mon b is not yet running
2022-03-05 02:04:36.850411 I | op-mon: mons running: [a]
2022-03-05 02:04:37.533440 I | op-mon: Monitors in quorum: [a]
2022-03-05 02:04:37.533483 I | op-mon: mons created: 2
2022-03-05 02:04:38.223093 I | op-mon: waiting for mon quorum with [a b]
2022-03-05 02:04:38.245327 I | op-mon: mon b is not yet running
2022-03-05 02:04:38.245385 I | op-mon: mons running: [a]
2022-03-05 02:04:43.265041 I | op-mon: mons running: [a b]
2022-03-05 02:04:44.057019 I | op-mon: Monitors in quorum: [a b]
2022-03-05 02:04:44.057066 I | op-config: setting "global"="mon allow pool delete"="true" option to the mon configuration database
2022-03-05 02:04:44.748623 I | op-config: successfully set "global"="mon allow pool delete"="true" option to the mon configuration database
2022-03-05 02:04:44.748666 I | op-config: setting "global"="mon cluster log file"="" option to the mon configuration database
2022-03-05 02:04:45.436895 I | op-config: successfully set "global"="mon cluster log file"="" option to the mon configuration database
2022-03-05 02:04:45.436936 I | op-config: setting "global"="mon allow pool size one"="true" option to the mon configuration database
2022-03-05 02:04:46.155629 I | op-config: successfully set "global"="mon allow pool size one"="true" option to the mon configuration database
2022-03-05 02:04:46.155660 I | op-config: setting "global"="osd scrub auto repair"="true" option to the mon configuration database
2022-03-05 02:04:46.858778 I | op-config: successfully set "global"="osd scrub auto repair"="true" option to the mon configuration database
2022-03-05 02:04:46.858811 I | op-config: setting "global"="log to file"="false" option to the mon configuration database
2022-03-05 02:04:47.543798 I | op-config: successfully set "global"="log to file"="false" option to the mon configuration database
2022-03-05 02:04:47.543836 I | op-config: setting "global"="rbd_default_features"="3" option to the mon configuration database
2022-03-05 02:04:48.228725 I | op-config: successfully set "global"="rbd_default_features"="3" option to the mon configuration database
2022-03-05 02:04:48.228764 I | op-config: deleting "log file" option from the mon configuration database
2022-03-05 02:04:48.938314 I | op-config: successfully deleted "log file" option from the mon configuration database
2022-03-05 02:04:48.938355 I | op-mon: creating mon c
2022-03-05 02:04:48.986666 I | op-mon: mon "a" endpoint is [v2:10.105.8.75:3300,v1:10.105.8.75:6789]
2022-03-05 02:04:49.031265 I | op-mon: mon "b" endpoint is [v2:10.109.89.77:3300,v1:10.109.89.77:6789]
2022-03-05 02:04:49.051489 I | op-mon: mon "c" endpoint is [v2:10.103.231.110:3300,v1:10.103.231.110:6789]
2022-03-05 02:04:49.346160 I | op-mon: saved mon endpoints to config map map[csi-cluster-config-json:[{"clusterID":"rook-ceph","monitors":["10.105.8.75:6789","10.109.89.77:6789","10.103.231.110:6789"]}] data:a=10.105.8.75:6789,b=10.109.89.77:6789,c=10.103.231.110:6789 mapping:{"node":{"a":{"Name":"k5","Hostname":"k5","Address":"10.0.0.15"},"b":{"Name":"k6","Hostname":"k6","Address":"10.0.0.16"},"c":{"Name":"k4","Hostname":"k4","Address":"10.0.0.14"}}} maxMonId:1]
2022-03-05 02:04:49.944432 I | cephclient: writing config file /var/lib/rook/rook-ceph/rook-ceph.config
2022-03-05 02:04:49.944715 I | cephclient: generated admin config in /var/lib/rook/rook-ceph
2022-03-05 02:04:50.356582 I | op-mon: 2 of 3 expected mon deployments exist. creating new deployment(s).
2022-03-05 02:04:50.364613 I | op-mon: deployment for mon rook-ceph-mon-a already exists. updating if needed
2022-03-05 02:04:50.379820 I | op-k8sutil: deployment "rook-ceph-mon-a" did not change, nothing to update
2022-03-05 02:04:50.387627 I | op-mon: deployment for mon rook-ceph-mon-b already exists. updating if needed
2022-03-05 02:04:50.400406 I | op-k8sutil: deployment "rook-ceph-mon-b" did not change, nothing to update
2022-03-05 02:04:50.544151 I | op-mon: updating maxMonID from 1 to 2 after committing mon "c"
2022-03-05 02:04:51.346693 I | op-mon: saved mon endpoints to config map map[csi-cluster-config-json:[{"clusterID":"rook-ceph","monitors":["10.105.8.75:6789","10.109.89.77:6789","10.103.231.110:6789"]}] data:c=10.103.231.110:6789,a=10.105.8.75:6789,b=10.109.89.77:6789 mapping:{"node":{"a":{"Name":"k5","Hostname":"k5","Address":"10.0.0.15"},"b":{"Name":"k6","Hostname":"k6","Address":"10.0.0.16"},"c":{"Name":"k4","Hostname":"k4","Address":"10.0.0.14"}}} maxMonId:2]
2022-03-05 02:04:51.346730 I | op-mon: waiting for mon quorum with [a b c]
2022-03-05 02:04:51.949645 I | op-mon: mon c is not yet running
2022-03-05 02:04:51.949687 I | op-mon: mons running: [a b]
2022-03-05 02:04:52.571493 I | op-mon: Monitors in quorum: [a b]
2022-03-05 02:04:52.571523 I | op-mon: mons created: 3
2022-03-05 02:04:53.323326 I | op-mon: waiting for mon quorum with [a b c]
2022-03-05 02:04:53.362450 I | op-mon: mon c is not yet running
2022-03-05 02:04:53.368565 I | op-mon: mons running: [a b]
2022-03-05 02:04:58.402415 I | op-mon: mons running: [a b c]
2022-03-05 02:04:59.062050 I | op-mon: Monitors in quorum: [a b c]
2022-03-05 02:04:59.062086 I | op-config: setting "global"="mon allow pool delete"="true" option to the mon configuration database
2022-03-05 02:04:59.768068 I | op-config: successfully set "global"="mon allow pool delete"="true" option to the mon configuration database
2022-03-05 02:04:59.768123 I | op-config: setting "global"="mon cluster log file"="" option to the mon configuration database
2022-03-05 02:05:00.953350 I | clusterdisruption-controller: reconciling osd pdb reconciler as the allowed disruptions in default pdb is 0
2022-03-05 02:05:01.340878 I | op-config: successfully set "global"="mon cluster log file"="" option to the mon configuration database
2022-03-05 02:05:01.340905 I | op-config: setting "global"="mon allow pool size one"="true" option to the mon configuration database
2022-03-05 02:05:02.770751 I | clusterdisruption-controller: reconciling osd pdb reconciler as the allowed disruptions in default pdb is 0
2022-03-05 02:05:02.962750 I | op-config: successfully set "global"="mon allow pool size one"="true" option to the mon configuration database
2022-03-05 02:05:02.962779 I | op-config: setting "global"="osd scrub auto repair"="true" option to the mon configuration database
2022-03-05 02:05:03.633404 I | op-config: successfully set "global"="osd scrub auto repair"="true" option to the mon configuration database
2022-03-05 02:05:03.633450 I | op-config: setting "global"="log to file"="false" option to the mon configuration database
2022-03-05 02:05:04.329027 I | op-config: successfully set "global"="log to file"="false" option to the mon configuration database
2022-03-05 02:05:04.329074 I | op-config: setting "global"="rbd_default_features"="3" option to the mon configuration database
2022-03-05 02:05:04.973527 I | op-config: successfully set "global"="rbd_default_features"="3" option to the mon configuration database
2022-03-05 02:05:04.973561 I | op-config: deleting "log file" option from the mon configuration database
2022-03-05 02:05:05.756922 I | op-config: successfully deleted "log file" option from the mon configuration database
2022-03-05 02:05:05.770940 I | cephclient: getting or creating ceph auth key "client.csi-rbd-provisioner"
2022-03-05 02:05:06.536921 I | cephclient: getting or creating ceph auth key "client.csi-rbd-node"
2022-03-05 02:05:07.268267 I | cephclient: getting or creating ceph auth key "client.csi-cephfs-provisioner"
2022-03-05 02:05:07.972069 I | cephclient: getting or creating ceph auth key "client.csi-cephfs-node"
2022-03-05 02:05:08.749672 I | ceph-csi: created kubernetes csi secrets for cluster "rook-ceph"
2022-03-05 02:05:08.749705 I | cephclient: getting or creating ceph auth key "client.crash"
2022-03-05 02:05:09.448025 I | ceph-crashcollector-controller: created kubernetes crash collector secret for cluster "rook-ceph"
2022-03-05 02:05:10.155293 I | cephclient: successfully enabled msgr2 protocol
2022-03-05 02:05:10.155335 I | op-config: deleting "mon_mds_skip_sanity" option from the mon configuration database
2022-03-05 02:05:10.852449 I | op-config: successfully deleted "mon_mds_skip_sanity" option from the mon configuration database
2022-03-05 02:05:10.852476 I | cephclient: create rbd-mirror bootstrap peer token "client.rbd-mirror-peer"
2022-03-05 02:05:10.852486 I | cephclient: getting or creating ceph auth key "client.rbd-mirror-peer"
2022-03-05 02:05:11.569679 I | cephclient: successfully created rbd-mirror bootstrap peer token for cluster "rook-ceph"
2022-03-05 02:05:11.598314 I | op-mgr: start running mgr
2022-03-05 02:05:11.598358 I | cephclient: getting or creating ceph auth key "mgr.a"
2022-03-05 02:05:12.537505 E | ceph-crashcollector-controller: node reconcile failed on op "unchanged": Operation cannot be fulfilled on deployments.apps "rook-ceph-crashcollector-k5": the object has been modified; please apply your changes to the latest version and try again
2022-03-05 02:05:20.540161 E | ceph-crashcollector-controller: node reconcile failed on op "unchanged": Operation cannot be fulfilled on deployments.apps "rook-ceph-crashcollector-k4": the object has been modified; please apply your changes to the latest version and try again
2022-03-05 02:05:20.562298 E | ceph-crashcollector-controller: node reconcile failed on op "unchanged": Operation cannot be fulfilled on deployments.apps "rook-ceph-crashcollector-k4": the object has been modified; please apply your changes to the latest version and try again
2022-03-05 02:05:32.259333 I | clusterdisruption-controller: reconciling osd pdb reconciler as the allowed disruptions in default pdb is 0
2022-03-05 02:05:33.423600 I | op-k8sutil: finished waiting for updated deployment "rook-ceph-mgr-a"
2022-03-05 02:05:33.431505 I | op-mgr: setting services to point to mgr "a"
2022-03-05 02:05:33.524526 I | op-mgr: no need to update service "rook-ceph-mgr"
2022-03-05 02:05:33.524652 I | op-mgr: no need to update service "rook-ceph-mgr-dashboard"
2022-03-05 02:05:33.525206 I | op-mgr: successful modules: balancer
2022-03-05 02:05:33.624040 I | op-osd: start running osds in namespace "rook-ceph"
2022-03-05 02:05:33.624230 I | op-osd: wait timeout for healthy OSDs during upgrade or restart is "10m0s"
2022-03-05 02:05:33.632471 I | op-osd: start provisioning the OSDs on PVCs, if needed
2022-03-05 02:05:33.638091 I | op-osd: no storageClassDeviceSets defined to configure OSDs on PVCs
2022-03-05 02:05:33.638120 I | op-osd: start provisioning the OSDs on nodes, if needed
2022-03-05 02:05:33.830344 I | op-osd: 3 of the 6 storage nodes are valid
2022-03-05 02:05:34.025311 I | op-osd: started OSD provisioning job for node "k4"
2022-03-05 02:05:34.224768 I | op-osd: started OSD provisioning job for node "k5"
2022-03-05 02:05:34.424518 I | op-osd: started OSD provisioning job for node "k6"
2022-03-05 02:05:34.430623 I | op-osd: OSD orchestration status for node k4 is "starting"
2022-03-05 02:05:34.430669 I | op-osd: OSD orchestration status for node k5 is "starting"
2022-03-05 02:05:34.430692 I | op-osd: OSD orchestration status for node k6 is "starting"
2022-03-05 02:05:35.724001 I | op-osd: OSD orchestration status for node k4 is "orchestrating"
2022-03-05 02:05:36.159281 I | op-osd: OSD orchestration status for node k5 is "orchestrating"
2022-03-05 02:05:36.425393 I | clusterdisruption-controller: reconciling osd pdb reconciler as the allowed disruptions in default pdb is 0
2022-03-05 02:05:36.732159 I | op-osd: OSD orchestration status for node k6 is "orchestrating"
2022-03-05 02:05:40.842188 I | op-mgr: successful modules: prometheus
2022-03-05 02:05:40.847402 I | op-config: setting "global"="osd_pool_default_pg_autoscale_mode"="on" option to the mon configuration database
2022-03-05 02:05:42.429980 I | op-config: successfully set "global"="osd_pool_default_pg_autoscale_mode"="on" option to the mon configuration database
2022-03-05 02:05:42.430010 I | op-config: setting "global"="mon_pg_warn_min_per_osd"="0" option to the mon configuration database
2022-03-05 02:05:43.865620 I | op-config: successfully set "global"="mon_pg_warn_min_per_osd"="0" option to the mon configuration database
2022-03-05 02:05:43.865652 I | op-mgr: successful modules: mgr module(s) from the spec
2022-03-05 02:05:45.781344 I | op-osd: OSD orchestration status for node k4 is "completed"
2022-03-05 02:05:45.781375 I | op-osd: creating OSD 0 on node "k4"
2022-03-05 02:05:45.934991 I | clusterdisruption-controller: osd "rook-ceph-osd-0" is down but no node drain is detected
2022-03-05 02:05:46.823329 I | op-osd: OSD orchestration status for node k5 is "completed"
2022-03-05 02:05:46.823360 I | op-osd: creating OSD 2 on node "k5"
2022-03-05 02:05:46.923939 I | op-osd: OSD orchestration status for node k6 is "completed"
2022-03-05 02:05:46.923972 I | op-osd: creating OSD 1 on node "k6"
2022-03-05 02:05:47.124479 E | ceph-crashcollector-controller: node reconcile failed on op "unchanged": Operation cannot be fulfilled on deployments.apps "rook-ceph-crashcollector-k5": the object has been modified; please apply your changes to the latest version and try again
2022-03-05 02:05:51.031679 I | clusterdisruption-controller: osd is down in the failure domain "k4", but pgs are active+clean. Requeuing in case pg status is not updated yet...
2022-03-05 02:05:51.037914 I | clusterdisruption-controller: osd "rook-ceph-osd-1" is down but no node drain is detected
2022-03-05 02:05:51.038095 I | clusterdisruption-controller: osd "rook-ceph-osd-2" is down but no node drain is detected
2022-03-05 02:05:51.038206 I | clusterdisruption-controller: osd "rook-ceph-osd-0" is down but no node drain is detected
2022-03-05 02:05:51.534749 E | ceph-crashcollector-controller: node reconcile failed on op "unchanged": Operation cannot be fulfilled on deployments.apps "rook-ceph-crashcollector-k5": the object has been modified; please apply your changes to the latest version and try again
2022-03-05 02:05:52.037192 I | op-osd: finished running OSDs in namespace "rook-ceph"
2022-03-05 02:05:52.037221 I | ceph-cluster-controller: done reconciling ceph cluster in namespace "rook-ceph"
2022-03-05 02:05:52.123944 I | ceph-cluster-controller: enabling ceph mon monitoring goroutine for cluster "rook-ceph"
2022-03-05 02:05:52.124027 I | op-osd: ceph osd status in namespace "rook-ceph" check interval "1m0s"
2022-03-05 02:05:52.124046 I | ceph-cluster-controller: enabling ceph osd monitoring goroutine for cluster "rook-ceph"
2022-03-05 02:05:52.124525 I | ceph-cluster-controller: ceph status check interval is 1m0s
2022-03-05 02:05:52.124555 I | ceph-cluster-controller: enabling ceph status monitoring goroutine for cluster "rook-ceph"
2022-03-05 02:05:53.037307 I | op-mgr: setting ceph dashboard "admin" login creds
2022-03-05 02:05:56.026944 I | clusterdisruption-controller: osd is down in the failure domain "k4", but pgs are active+clean. Requeuing in case pg status is not updated yet...
2022-03-05 02:05:57.647613 I | op-mgr: successfully set ceph dashboard creds
2022-03-05 02:06:00.028374 I | ceph-cluster-controller: Disabling the insecure global ID as no legacy clients are currently connected. If you still require the insecure connections, see the CVE to suppress the health warning and re-enable the insecure connections. https://docs.ceph.com/en/latest/security/CVE-2021-20288/
2022-03-05 02:06:00.028437 I | op-config: setting "mon"="auth_allow_insecure_global_id_reclaim"="false" option to the mon configuration database
2022-03-05 02:06:02.331488 I | clusterdisruption-controller: osd "rook-ceph-osd-2" is down but no node drain is detected
2022-03-05 02:06:02.331907 I | clusterdisruption-controller: osd "rook-ceph-osd-1" is down but no node drain is detected
2022-03-05 02:06:02.332545 I | clusterdisruption-controller: osd "rook-ceph-osd-0" is down but no node drain is detected
2022-03-05 02:06:02.435767 I | op-config: successfully set "mon"="auth_allow_insecure_global_id_reclaim"="false" option to the mon configuration database
2022-03-05 02:06:02.435796 I | ceph-cluster-controller: insecure global ID is now disabled
2022-03-05 02:06:05.038744 I | op-config: setting "mgr.a"="mgr/dashboard/server_port"="8443" option to the mon configuration database
2022-03-05 02:06:05.443498 I | clusterdisruption-controller: osd is down in the failure domain "k4", but pgs are active+clean. Requeuing in case pg status is not updated yet...
2022-03-05 02:06:05.840611 I | op-mon: parsing mon endpoints: c=10.103.231.110:6789,a=10.105.8.75:6789,b=10.109.89.77:6789
2022-03-05 02:06:05.933927 I | op-mon: parsing mon endpoints: c=10.103.231.110:6789,a=10.105.8.75:6789,b=10.109.89.77:6789
2022-03-05 02:06:05.934054 I | ceph-spec: detecting the ceph image version for image quay.io/ceph/ceph:v16.2.7...
2022-03-05 02:06:06.037445 I | op-mon: parsing mon endpoints: c=10.103.231.110:6789,a=10.105.8.75:6789,b=10.109.89.77:6789
2022-03-05 02:06:06.037521 I | ceph-spec: detecting the ceph image version for image quay.io/ceph/ceph:v16.2.7...
2022-03-05 02:06:06.329866 I | clusterdisruption-controller: osd "rook-ceph-osd-2" is down but no node drain is detected
2022-03-05 02:06:06.330233 I | clusterdisruption-controller: osd "rook-ceph-osd-1" is down but no node drain is detected
2022-03-05 02:06:08.332949 I | op-config: successfully set "mgr.a"="mgr/dashboard/server_port"="8443" option to the mon configuration database
2022-03-05 02:06:08.623384 I | ceph-spec: detected ceph image version: "16.2.7-0 pacific"
2022-03-05 02:06:08.623924 I | ceph-spec: detected ceph image version: "16.2.7-0 pacific"
2022-03-05 02:06:11.929119 I | ceph-block-pool-controller: creating pool "ceph-blockpool" in namespace "rook-ceph"
2022-03-05 02:06:17.026472 I | clusterdisruption-controller: osd is down in the failure domain "k5", but pgs are active+clean. Requeuing in case pg status is not updated yet...
2022-03-05 02:06:18.823160 I | op-mgr: dashboard config has changed. restarting the dashboard module
2022-03-05 02:06:18.823343 I | op-mgr: restarting the mgr module
2022-03-05 02:06:31.923601 I | ceph-file-controller: start running mdses for filesystem "ceph-filesystem"
2022-03-05 02:06:41.023288 I | cephclient: getting or creating ceph auth key "mds.ceph-filesystem-a"
2022-03-05 02:06:41.725066 I | ceph-object-controller: reconciling object store deployments
2022-03-05 02:06:41.823571 I | ceph-object-controller: ceph object store gateway service running at 10.110.222.53
2022-03-05 02:06:41.823724 I | ceph-object-controller: reconciling object store pools
2022-03-05 02:06:42.223504 I | op-mgr: successful modules: dashboard
2022-03-05 02:06:47.133594 I | op-mon: checking if multiple mons are on the same node
2022-03-05 02:06:48.923258 I | op-mds: setting mds config flags
2022-03-05 02:06:48.923383 I | op-config: setting "mds.ceph-filesystem-a"="mds_join_fs"="ceph-filesystem" option to the mon configuration database
2022-03-05 02:06:54.132780 I | op-config: successfully set "mds.ceph-filesystem-a"="mds_join_fs"="ceph-filesystem" option to the mon configuration database
2022-03-05 02:06:54.225769 I | cephclient: getting or creating ceph auth key "mds.ceph-filesystem-b"
2022-03-05 02:06:54.425026 E | ceph-crashcollector-controller: node reconcile failed on op "unchanged": Operation cannot be fulfilled on deployments.apps "rook-ceph-crashcollector-k5": the object has been modified; please apply your changes to the latest version and try again
2022-03-05 02:06:57.623115 I | cephclient: reconciling replicated pool ceph-blockpool succeeded
2022-03-05 02:06:58.723242 E | ceph-crashcollector-controller: node reconcile failed on op "unchanged": Operation cannot be fulfilled on deployments.apps "rook-ceph-crashcollector-k5": the object has been modified; please apply your changes to the latest version and try again
2022-03-05 02:07:04.523450 I | op-mds: setting mds config flags
2022-03-05 02:07:04.523509 I | op-config: setting "mds.ceph-filesystem-b"="mds_join_fs"="ceph-filesystem" option to the mon configuration database
2022-03-05 02:07:13.923101 I | op-config: successfully set "mds.ceph-filesystem-b"="mds_join_fs"="ceph-filesystem" option to the mon configuration database
2022-03-05 02:07:15.023486 I | ceph-block-pool-controller: initializing pool "ceph-blockpool"
2022-03-05 02:07:18.633307 I | ceph-block-pool-controller: successfully initialized pool "ceph-blockpool"
2022-03-05 02:07:18.633652 I | op-config: deleting "mgr/prometheus/rbd_stats_pools" option from the mon configuration database
2022-03-05 02:07:25.430237 I | op-config: successfully deleted "mgr/prometheus/rbd_stats_pools" option from the mon configuration database
2022-03-05 02:07:26.023574 I | cephclient: reconciling replicated pool ceph-objectstore.rgw.control succeeded
2022-03-05 02:07:31.849658 I | ceph-file-controller: creating filesystem "ceph-filesystem"
2022-03-05 02:07:35.931604 I | cephclient: setting pool property "pg_num_min" to "8" on pool "ceph-objectstore.rgw.control"
2022-03-05 02:07:43.030696 I | cephclient: reconciling replicated pool ceph-filesystem-metadata succeeded
2022-03-05 02:07:51.423075 I | cephclient: reconciling replicated pool ceph-filesystem-data0 succeeded
2022-03-05 02:07:54.525970 I | cephclient: reconciling replicated pool ceph-objectstore.rgw.meta succeeded
2022-03-05 02:07:55.423108 I | cephclient: creating filesystem "ceph-filesystem" with metadata pool "ceph-filesystem-metadata" and data pools [ceph-filesystem-data0]
2022-03-05 02:07:59.630446 I | cephclient: setting pool property "pg_num_min" to "8" on pool "ceph-objectstore.rgw.meta"
2022-03-05 02:08:01.931448 I | ceph-file-controller: created filesystem "ceph-filesystem" on 1 data pool(s) and metadata pool "ceph-filesystem-metadata"
2022-03-05 02:08:01.931478 I | cephclient: setting allow_standby_replay for filesystem "ceph-filesystem"
2022-03-05 02:08:14.911833 I | cephclient: reconciling replicated pool ceph-objectstore.rgw.log succeeded
2022-03-05 02:08:17.135036 I | cephclient: setting pool property "pg_num_min" to "8" on pool "ceph-objectstore.rgw.log"
2022-03-05 02:08:32.942945 I | cephclient: reconciling replicated pool ceph-objectstore.rgw.buckets.index succeeded
2022-03-05 02:08:35.060385 I | cephclient: setting pool property "pg_num_min" to "8" on pool "ceph-objectstore.rgw.buckets.index"
```

### ceph cluster 확인

아래 명령어를 실행하여 pod 상태를 확인합니다.

```bash
kubectl -n rook-ceph get pod
```

모든 파드가 running이 되었고, osd 파드도 3개 생긴걸 알 수있습니다. 환경에 따라 갯수를 달라질 수 있습니다.

```
(base) joonwookim@Joonwooui-MacBookPro ~ % kubectl -n rook-ceph get pod
NAME                                                READY   STATUS      RESTARTS   AGE
csi-cephfsplugin-7dfcd                              3/3     Running     0          7m35s
csi-cephfsplugin-88m29                              3/3     Running     0          7m35s
csi-cephfsplugin-lg5bk                              3/3     Running     0          7m35s
csi-cephfsplugin-provisioner-5dc9cbcc87-npjrw       6/6     Running     0          7m35s
csi-cephfsplugin-provisioner-5dc9cbcc87-pk7dp       6/6     Running     0          7m35s
csi-rbdplugin-jnb5b                                 3/3     Running     0          7m36s
csi-rbdplugin-l768k                                 3/3     Running     0          7m36s
csi-rbdplugin-provisioner-58f584754c-gzmm4          6/6     Running     0          7m36s
csi-rbdplugin-provisioner-58f584754c-w224q          6/6     Running     0          7m36s
csi-rbdplugin-sk8c8                                 3/3     Running     0          7m36s
rook-ceph-crashcollector-k4-67d694c8-rvfz9          1/1     Running     0          5m51s
rook-ceph-crashcollector-k5-5c5f7d4969-2hlzv        1/1     Running     0          4m17s
rook-ceph-crashcollector-k6-75b6b99d64-h62cr        1/1     Running     0          5m37s
rook-ceph-mds-ceph-filesystem-a-67b9bbc648-dzd25    1/1     Running     0          4m17s
rook-ceph-mds-ceph-filesystem-b-99d9f9f6d-c584t     1/1     Running     0          3m58s
rook-ceph-mgr-a-579d76b94-jnjjr                     1/1     Running     0          5m59s
rook-ceph-mon-a-5966c66bb4-zqrpv                    1/1     Running     0          7m38s
rook-ceph-mon-b-5d97b4d79f-bkfsh                    1/1     Running     0          6m36s
rook-ceph-mon-c-6ffdbfdb6c-q26vb                    1/1     Running     0          6m21s
rook-ceph-operator-7bc8964f4d-4ttgh                 1/1     Running     0          13m
rook-ceph-osd-0-5b575bc997-w6gxf                    1/1     Running     0          5m26s
rook-ceph-osd-1-9cfb4f647-rslz7                     1/1     Running     0          5m25s
rook-ceph-osd-2-849d79dc98-jwknq                    1/1     Running     0          5m25s
rook-ceph-osd-prepare-k4-sqlqq                      0/1     Completed   0          5m38s
rook-ceph-osd-prepare-k5-qxf6b                      0/1     Completed   0          5m37s
rook-ceph-osd-prepare-k6-kt9wj                      0/1     Completed   0          5m37s
rook-ceph-rgw-ceph-objectstore-a-86cbd4d888-c2srq   1/1     Running     0          104s
rook-ceph-tools-7d94694498-nz664                    1/1     Running     0          7m46s
```

### storageClass 확인

기본적으로 block, filesystem, object 를 제공하고 있습니다. storageclass 를 확인해봅니다. 

![Untitled](/images/2022-03-06-Ceph-Cluster-install-with-helm/Untitled-5.png)

### PVC 생성

ceph-block 으로 pvc를 생성해봅니다.

pvc.yaml 내용

```bash
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: example-pvc
spec:
  storageClassName: ceph-block
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
```

pvc.yaml 배포와 PVC 생성이 되며 PVC 상태도 bound으로 잘나오는걸 확인 할 수 있습니다.

![Untitled](/images/2022-03-06-Ceph-Cluster-install-with-helm/Untitled-6.png)


## 마무리

ceph는 쿠버네티스 스토리지영역에서 많이 호환이 됩니다. rook 을 통해 ceph를 쉽게 클러스터를 구성을 도와줍니다. 추가로 helm을 사용하면 좀더 편하게 구성할 수가 있었습니다.


### 참고링크

- https://kubernetes.io/ko/docs/concepts/storage/storage-classes/
- [https://www.redhat.com/ko/topics/data-storage/software-defined-storage](https://www.redhat.com/ko/topics/data-storage/software-defined-storage)
- [https://base-on.tistory.com/415](https://base-on.tistory.com/415)
- [https://access.redhat.com/documentation/en-us/red_hat_ceph_storage/3/html/red_hat_ceph_storage_hardware_selection_guide/ceph-hardware-min-recommend](https://access.redhat.com/documentation/en-us/red_hat_ceph_storage/3/html/red_hat_ceph_storage_hardware_selection_guide/ceph-hardware-min-recommend)
- [https://github.com/rook/rook/blob/master/Documentation/helm-ceph-cluster.md](https://github.com/rook/rook/blob/master/Documentation/helm-ceph-cluster.md)
- [https://github.com/rook/rook/blob/master/Documentation/helm-operator.md](https://github.com/rook/rook/blob/master/Documentation/helm-operator.md)

