# IronStock Mock Data Seed Script
# DevOps pipeline ekosistemi icin gercekci test verisi olusturur.
#
# Kullanim: .\scripts\seed_mock_data.ps1
# Not: Docker Compose stack calisiyor olmali (server:8080)

$ErrorActionPreference = "Stop"

$BASE = "http://localhost:8080/api/v1"

# RNG - PS 5.1 uyumlu
$script:rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider

function Req {
    param(
        [string]$Method,
        [string]$Path,
        [hashtable]$Headers,
        [object]$Body
    )
    $uri = "$BASE$Path"
    $params = @{
        Method      = $Method
        Uri         = $uri
        ContentType = "application/json"
    }
    if ($Headers) { $params.Headers = $Headers }
    if ($null -ne $Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
    }
    try {
        return Invoke-RestMethod @params
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "  HATA [$Method $Path] => HTTP $statusCode" -ForegroundColor Red
        Write-Host "  $($_.ErrorDetails.Message)" -ForegroundColor Red
        throw
    }
}

function NewUUID {
    return [System.Guid]::NewGuid().ToString()
}

function FakeB64 {
    param([int]$n)
    $buf = New-Object byte[] $n
    $script:rng.GetBytes($buf)
    return [System.Convert]::ToBase64String($buf)
}

# ────────────────────────────────────────────────────────────
# 1. LOGIN
# ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[1/9] Admin olarak giris yapiliyor..." -ForegroundColor Cyan
$loginResp = Req -Method POST -Path "/auth/bootstrap/login" -Body @{
    username = "admin"
    password = "SeedAdmin2026!!"
}
$token = $loginResp.access_token
$H = @{ Authorization = "Bearer $token" }
Write-Host "  OK: Giris basarili."

# ────────────────────────────────────────────────────────────
# 2. KLASORLER
# ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[2/9] Klasorler olusturuluyor..." -ForegroundColor Cyan
$folders = @{}

$f1 = Req -Method POST -Path "/folders" -Headers $H -Body @{ name = "Production"; position = 1 }
$folders["Production"] = $f1.id

$f2 = Req -Method POST -Path "/folders" -Headers $H -Body @{ name = "Staging"; position = 2 }
$folders["Staging"] = $f2.id

$f3 = Req -Method POST -Path "/folders" -Headers $H -Body @{ name = "Development"; position = 3 }
$folders["Development"] = $f3.id

$f4 = Req -Method POST -Path "/folders" -Headers $H -Body @{ name = "CICD Araclari"; position = 4 }
$folders["CICD"] = $f4.id

$f5 = Req -Method POST -Path "/folders" -Headers $H -Body @{ name = "Kubernetes Clusters"; parent_id = $folders["Production"]; position = 1 }
$folders["Prod/K8s"] = $f5.id

$f6 = Req -Method POST -Path "/folders" -Headers $H -Body @{ name = "Veritabanlari"; parent_id = $folders["Production"]; position = 2 }
$folders["Prod/DB"] = $f6.id

$f7 = Req -Method POST -Path "/folders" -Headers $H -Body @{ name = "Gozlemlenebilirlik"; parent_id = $folders["Production"]; position = 3 }
$folders["Prod/Obs"] = $f7.id

$f8 = Req -Method POST -Path "/folders" -Headers $H -Body @{ name = "Kubernetes Clusters"; parent_id = $folders["Staging"]; position = 1 }
$folders["Stg/K8s"] = $f8.id

$f9 = Req -Method POST -Path "/folders" -Headers $H -Body @{ name = "Veritabanlari"; parent_id = $folders["Staging"]; position = 2 }
$folders["Stg/DB"] = $f9.id

Write-Host "  OK: $($folders.Count) klasor olusturuldu."

# ────────────────────────────────────────────────────────────
# 3. KULLANICILAR
# ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/9] Test kullanicilari olusturuluyor..." -ForegroundColor Cyan
$users = @{}

$u1 = Req -Method POST -Path "/admin/users" -Headers $H -Body @{
    username = "devops_lead"
    email    = "devops.lead@ironstock.local"
    password = "DevOpsLead2026Xz"
    roles    = @("write", "read")
}
$users["devops_lead"] = $u1.id
Write-Host "  OK: devops_lead"

$u2 = Req -Method POST -Path "/admin/users" -Headers $H -Body @{
    username = "sre_engineer"
    email    = "sre@ironstock.local"
    password = "SREEngineer2026Xz"
    roles    = @("write", "read")
}
$users["sre_engineer"] = $u2.id
Write-Host "  OK: sre_engineer"

$u3 = Req -Method POST -Path "/admin/users" -Headers $H -Body @{
    username = "sec_auditor"
    email    = "security@ironstock.local"
    password = "SecAuditor2026Xz"
    roles    = @("read")
}
$users["sec_auditor"] = $u3.id
Write-Host "  OK: sec_auditor"

$u4 = Req -Method POST -Path "/admin/users" -Headers $H -Body @{
    username = "qa_engineer"
    email    = "qa@ironstock.local"
    password = "QAEngineer2026Xz"
    roles    = @("read")
}
$users["qa_engineer"] = $u4.id
Write-Host "  OK: qa_engineer"

# ────────────────────────────────────────────────────────────
# 4. GRUPLAR
# ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[4/9] Gruplar olusturuluyor..." -ForegroundColor Cyan
$groups = @{}

$g1 = Req -Method POST -Path "/admin/groups" -Headers $H -Body @{
    name        = "DevOps Takimi"
    description = "Uygulama dagitiim ve CICD sorumlulaari"
}
$groups["devops"] = $g1.id
Req -Method POST -Path "/admin/groups/$($g1.id)/members" -Headers $H -Body @{ user_id = $users["devops_lead"] } | Out-Null
Req -Method POST -Path "/admin/groups/$($g1.id)/members" -Headers $H -Body @{ user_id = $users["sre_engineer"] } | Out-Null
Write-Host "  OK: DevOps Takimi (2 uye)"

$g2 = Req -Method POST -Path "/admin/groups" -Headers $H -Body @{
    name        = "Guvenlik Ekibi"
    description = "Guvenlik denetimi ve izleme"
}
$groups["security"] = $g2.id
Req -Method POST -Path "/admin/groups/$($g2.id)/members" -Headers $H -Body @{ user_id = $users["sec_auditor"] } | Out-Null
Write-Host "  OK: Guvenlik Ekibi (1 uye)"

$g3 = Req -Method POST -Path "/admin/groups" -Headers $H -Body @{
    name        = "QA Ekibi"
    description = "Test ve kalite guvencesi"
}
$groups["qa"] = $g3.id
Req -Method POST -Path "/admin/groups/$($g3.id)/members" -Headers $H -Body @{ user_id = $users["qa_engineer"] } | Out-Null
Write-Host "  OK: QA Ekibi (1 uye)"

# ────────────────────────────────────────────────────────────
# 5. ETIKETLER
# ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[5/9] Etiketler olusturuluyor..." -ForegroundColor Cyan
$tags = @{}

$tagList = @(
    @{ name = "production";  color = "#ef4444" },
    @{ name = "staging";     color = "#f59e0b" },
    @{ name = "development"; color = "#22c55e" },
    @{ name = "critical";    color = "#dc2626" },
    @{ name = "kubernetes";  color = "#3b82f6" },
    @{ name = "database";    color = "#8b5cf6" },
    @{ name = "monitoring";  color = "#06b6d4" },
    @{ name = "ci-cd";       color = "#f97316" },
    @{ name = "security";    color = "#ec4899" },
    @{ name = "deprecated";  color = "#6b7280" }
)
foreach ($t in $tagList) {
    $tr = Req -Method POST -Path "/tags" -Headers $H -Body @{ name = $t.name; color = $t.color }
    $tags[$t.name] = $tr.id
}
Write-Host "  OK: $($tags.Count) etiket olusturuldu."

# ────────────────────────────────────────────────────────────
# 6. ITEMLAR
# ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[6/9] Item'lar olusturuluyor..." -ForegroundColor Cyan
$items = @{}

function MkItem {
    param(
        [string]$Name,
        [string]$Key,
        [string]$FolderKey,
        [int]$TypeID,
        [string]$Desc,
        [int[]]$Stages,
        [string[]]$TagList,
        [switch]$Fav
    )
    $id         = NewUUID
    $dekWrapped = FakeB64 48
    $wrapNonce  = FakeB64 12

    $body = @{
        id                = $id
        folder_id         = $folders[$FolderKey]
        item_type_id      = $TypeID
        name              = $Name
        description       = $Desc
        fields            = @()
        owner_dek_wrapped = $dekWrapped
        owner_wrap_nonce  = $wrapNonce
    }

    $resp = Req -Method POST -Path "/items" -Headers $H -Body $body
    $items[$Key] = $resp.id
    Write-Host "  OK: $Name"

    if ($Stages.Count -gt 0) {
        Req -Method POST -Path "/items/$($resp.id)/lifecycle-stages" -Headers $H -Body @{
            stage_ids = $Stages
        } | Out-Null
    }

    foreach ($tn in $TagList) {
        if ($tags.ContainsKey($tn)) {
            Req -Method POST -Path "/items/$($resp.id)/tags" -Headers $H -Body @{
                tag_id = $tags[$tn]
            } | Out-Null
        }
    }

    if ($Fav) {
        Req -Method POST -Path "/items/$($resp.id)/favorite" -Headers $H | Out-Null
    }
}

# Planlama - stage 1
MkItem -Name "Jira Software" -Key "jira" -FolderKey "CICD" -TypeID 2 `
    -Desc "Scrum/Kanban proje yonetimi ve sprint takibi. Tum takimlarin birincil is takibi araci." `
    -Stages @(1) -TagList @("ci-cd") -Fav

MkItem -Name "Confluence" -Key "confluence" -FolderKey "CICD" -TypeID 2 `
    -Desc "Teknik dokumantasyon, runbook ve mimari kararlar wikisi." `
    -Stages @(1) -TagList @("ci-cd")

# Kaynak Kod - stage 2
MkItem -Name "Bitbucket Cloud" -Key "bitbucket" -FolderKey "CICD" -TypeID 2 `
    -Desc "Ana kaynak kod deposu. Tum uygulama ve altyapi repolari burada barindiriliir." `
    -Stages @(2) -TagList @("ci-cd", "critical") -Fav

MkItem -Name "GitLab CE" -Key "gitlab" -FolderKey "CICD" -TypeID 2 `
    -Desc "Ikincil SCM ve container registry. Legacy projeler buraya gecirilmektedir." `
    -Stages @(2) -TagList @("ci-cd")

# Build - stage 3
MkItem -Name "Jenkins" -Key "jenkins" -FolderKey "CICD" -TypeID 2 `
    -Desc "CI/CD orchestrator. Bitbucketten tetiklenen pipelinelaari calistirir: test, build, push Harbor." `
    -Stages @(3) -TagList @("ci-cd", "critical") -Fav

MkItem -Name "Docker Hub" -Key "dockerhub" -FolderKey "CICD" -TypeID 2 `
    -Desc "Base image kaynagi. Internal imageler Harborda tutulur; public base imageler buradan cekilir." `
    -Stages @(3) -TagList @("ci-cd")

MkItem -Name "Kaniko" -Key "kaniko" -FolderKey "CICD" -TypeID 8 `
    -Desc "Kubernetes pod icinde Docker daemon olmadan image build icin kullanilir." `
    -Stages @(3) -TagList @("ci-cd", "kubernetes")

# Test - stage 4
MkItem -Name "SonarQube" -Key "sonarqube" -FolderKey "CICD" -TypeID 2 `
    -Desc "Statik kod analizi ve guvenlik acigi taramasi. Quality Gate gecemeyen PRlar merge edilmez." `
    -Stages @(2, 4) -TagList @("ci-cd", "security")

MkItem -Name "Trivy Scanner" -Key "trivy" -FolderKey "CICD" -TypeID 8 `
    -Desc "Container image ve bagimlilik guvenlik acigi tarayici. Harbor entegrasyonu aktif." `
    -Stages @(4) -TagList @("ci-cd", "security")

# Release - stage 5
MkItem -Name "Harbor Container Registry" -Key "harbor" -FolderKey "CICD" -TypeID 2 `
    -Desc "Self-hosted container registry. Jenkinsin build ettigi imageler burada saklanir. Trivy ile entegre guvenlik taramasi." `
    -Stages @(4, 5) -TagList @("ci-cd", "critical", "security") -Fav

# Deploy - stage 6
MkItem -Name "ArgoCD" -Key "argocd" -FolderKey "CICD" -TypeID 2 `
    -Desc "GitOps CD araci. Git reposundaki Helm chart degisikliklerini AKS clusterlaarina otomatik uygular." `
    -Stages @(6) -TagList @("ci-cd", "critical", "kubernetes") -Fav

MkItem -Name "AKS Production" -Key "aks-prod" -FolderKey "Prod/K8s" -TypeID 1 `
    -Desc "Azure Kubernetes Service production cluster. 3 node pool: system, app ve gpu. Bolge: westeurope." `
    -Stages @(6, 7) -TagList @("production", "kubernetes", "critical") -Fav

MkItem -Name "AKS Staging" -Key "aks-staging" -FolderKey "Stg/K8s" -TypeID 1 `
    -Desc "Azure Kubernetes Service staging cluster. 2 node pool: system ve app. UAT testleri burada calisir." `
    -Stages @(6, 7) -TagList @("staging", "kubernetes")

# Isletim - stage 7
MkItem -Name "PostgreSQL Production" -Key "pg-prod" -FolderKey "Prod/DB" -TypeID 3 `
    -Desc "Ana uygulama veritabani. Azure Database for PostgreSQL Flexible Server. HA ve geo-redundant backup." `
    -Stages @(7) -TagList @("production", "database", "critical") -Fav

MkItem -Name "PostgreSQL Staging" -Key "pg-staging" -FolderKey "Stg/DB" -TypeID 3 `
    -Desc "Staging ortami veritabani. Productiondan haftalik restore ile guncellenir." `
    -Stages @(7) -TagList @("staging", "database")

MkItem -Name "Redis Cache" -Key "redis" -FolderKey "Prod/DB" -TypeID 8 `
    -Desc "Session cache ve queue icin Redis Cluster. 3 master ve 3 replica. Azure Cache for Redis Premium tier." `
    -Stages @(7) -TagList @("production", "database")

MkItem -Name "HashiCorp Vault" -Key "vault" -FolderKey "CICD" -TypeID 2 `
    -Desc "Secret yonetim platformu. Uygulama secretlari ve PKI sertifikalari buradan dagitilir." `
    -Stages @(7) -TagList @("security", "critical") -Fav

# Izleme - stage 8
MkItem -Name "Grafana" -Key "grafana" -FolderKey "Prod/Obs" -TypeID 2 `
    -Desc "Ana gozlemlenebilirlik dashboardu. Prometheus metrikleri, Loki loglari ve Tempo traceler tek ekranda." `
    -Stages @(8) -TagList @("monitoring", "production") -Fav

MkItem -Name "Prometheus" -Key "prometheus" -FolderKey "Prod/Obs" -TypeID 2 `
    -Desc "Kubernetes ve uygulama metrik toplama. 30 gun retention. AlertManager ile Slack ve PagerDuty uyarilari." `
    -Stages @(8) -TagList @("monitoring", "production")

MkItem -Name "Loki" -Key "loki" -FolderKey "Prod/Obs" -TypeID 2 `
    -Desc "Log aggregation servisi. Promtail ile Kubernetes pod loglari toplanir. 14 gun retention." `
    -Stages @(8) -TagList @("monitoring", "production")

MkItem -Name "PagerDuty" -Key "pagerduty" -FolderKey "CICD" -TypeID 2 `
    -Desc "On-call rotation ve incident yonetimi. AlertManager entegrasyonu ile kritik uyarilar escalate edilir." `
    -Stages @(8) -TagList @("monitoring", "critical")

Write-Host "  TOPLAM: $($items.Count) item olusturuldu."

# ────────────────────────────────────────────────────────────
# 7. ILISKILER
# ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[7/9] Iliskiler olusturuluyor..." -ForegroundColor Cyan

function AddRel {
    param([string]$From, [string]$To, [string]$Type)
    Req -Method POST -Path "/items/$($items[$From])/relationships" -Headers $H -Body @{
        target_id = $items[$To]
        type      = $Type
    } | Out-Null
    Write-Host "  $From --[$Type]--> $To"
}

# SCM -> CI
AddRel "bitbucket"  "jenkins"     "builds_to"
AddRel "gitlab"     "jenkins"     "builds_to"

# CI araclari
AddRel "jenkins"    "sonarqube"   "scans_with"
AddRel "jenkins"    "trivy"       "scans_with"
AddRel "jenkins"    "harbor"      "builds_to"
AddRel "jenkins"    "kaniko"      "uses_tool"
AddRel "jenkins"    "dockerhub"   "depends_on"

# Registry -> CD -> Clusters
AddRel "harbor"     "argocd"      "builds_to"
AddRel "argocd"     "aks-prod"    "deploys_to"
AddRel "argocd"     "aks-staging" "deploys_to"

# Cluster bagimliliklari
AddRel "aks-prod"     "pg-prod"     "depends_on"
AddRel "aks-prod"     "redis"       "depends_on"
AddRel "aks-staging"  "pg-staging"  "depends_on"

# Secret yonetimi
AddRel "argocd"     "vault"       "uses_tool"
AddRel "aks-prod"   "vault"       "uses_tool"

# Observability
AddRel "grafana"    "prometheus"  "depends_on"
AddRel "grafana"    "loki"        "depends_on"
AddRel "prometheus" "aks-prod"    "depends_on"
AddRel "loki"       "aks-prod"    "depends_on"
AddRel "prometheus" "pagerduty"   "uses_tool"

# Planlama
AddRel "jira"       "bitbucket"   "related_to"
AddRel "confluence" "jira"        "related_to"

# ────────────────────────────────────────────────────────────
# 8. KLASOR IZINLERI
# ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[8/9] Klasor izinleri ataniyor..." -ForegroundColor Cyan

# DevOps takimi Production ve Staging'e write erisimi
Req -Method POST -Path "/folders/$($folders['Production'])/permissions" -Headers $H -Body @{
    user_id    = $users["devops_lead"]
    permission = "write"
} | Out-Null
Write-Host "  OK: devops_lead -> Production (write)"

Req -Method POST -Path "/folders/$($folders['Production'])/permissions" -Headers $H -Body @{
    user_id    = $users["sre_engineer"]
    permission = "write"
} | Out-Null
Write-Host "  OK: sre_engineer -> Production (write)"

Req -Method POST -Path "/folders/$($folders['Staging'])/permissions" -Headers $H -Body @{
    user_id    = $users["devops_lead"]
    permission = "write"
} | Out-Null
Write-Host "  OK: devops_lead -> Staging (write)"

# Guvenlik ekibi read erisimi
Req -Method POST -Path "/folders/$($folders['CICD'])/permissions" -Headers $H -Body @{
    user_id    = $users["sec_auditor"]
    permission = "read"
} | Out-Null
Write-Host "  OK: sec_auditor -> CICD Araclari (read)"

Req -Method POST -Path "/folders/$($folders['Production'])/permissions" -Headers $H -Body @{
    user_id    = $users["sec_auditor"]
    permission = "read"
} | Out-Null
Write-Host "  OK: sec_auditor -> Production (read)"

# QA read erisimi
Req -Method POST -Path "/folders/$($folders['Staging'])/permissions" -Headers $H -Body @{
    user_id    = $users["qa_engineer"]
    permission = "read"
} | Out-Null
Write-Host "  OK: qa_engineer -> Staging (read)"

# ────────────────────────────────────────────────────────────
# 9. PIPELINE DIYAGRAMLARI
# ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[9/9] Pipeline diyagramlari olusturuluyor..." -ForegroundColor Cyan

# Diyagram 1: Production CI/CD
$d1 = Req -Method POST -Path "/pipeline-diagrams" -Headers $H -Body @{
    name        = "Production CI/CD Pipeline"
    description = "Bitbucketten AKS Productiona tam dagitiim akisi. Otomatik test, guvenlik taramasi ve GitOps deploy adimlarini icerir."
    layout_data = @{ viewport = @{ x = 0; y = 0; zoom = 0.85 } }
}
Req -Method POST -Path "/pipeline-diagrams/$($d1.id)/nodes" -Headers $H -Body @{
    item_ids = @(
        $items["bitbucket"], $items["jenkins"], $items["sonarqube"],
        $items["trivy"], $items["harbor"], $items["argocd"],
        $items["aks-prod"], $items["pg-prod"]
    )
} | Out-Null
Write-Host "  OK: 'Production CI/CD Pipeline' (8 node)"

# Diyagram 2: Full DevOps Lifecycle
$d2 = Req -Method POST -Path "/pipeline-diagrams" -Headers $H -Body @{
    name        = "Full DevOps Lifecycle"
    description = "Plan asamasindan izleme asamasina kadar tum DevOps arac ekosistemine genel bakis."
    layout_data = @{ viewport = @{ x = 0; y = 0; zoom = 0.7 } }
}
Req -Method POST -Path "/pipeline-diagrams/$($d2.id)/nodes" -Headers $H -Body @{
    item_ids = @(
        $items["jira"], $items["confluence"], $items["bitbucket"],
        $items["jenkins"], $items["sonarqube"], $items["harbor"],
        $items["argocd"], $items["aks-prod"], $items["pg-prod"],
        $items["vault"], $items["grafana"], $items["prometheus"],
        $items["pagerduty"]
    )
} | Out-Null
Write-Host "  OK: 'Full DevOps Lifecycle' (13 node)"

# Diyagram 3: Observability Stack
$d3 = Req -Method POST -Path "/pipeline-diagrams" -Headers $H -Body @{
    name        = "Gozlemlenebilirlik Stack"
    description = "Grafana, Prometheus, Loki ve PagerDuty ile olusturulan izleme altyapisi."
    layout_data = @{ viewport = @{ x = 0; y = 0; zoom = 1.0 } }
}
Req -Method POST -Path "/pipeline-diagrams/$($d3.id)/nodes" -Headers $H -Body @{
    item_ids = @(
        $items["aks-prod"], $items["prometheus"],
        $items["loki"], $items["grafana"], $items["pagerduty"]
    )
} | Out-Null
Write-Host "  OK: 'Gozlemlenebilirlik Stack' (5 node)"

# ────────────────────────────────────────────────────────────
# OZET
# ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  Mock data basariyla olusturuldu!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Klasorler   : $($folders.Count)"
Write-Host "  Kullanicilar: $($users.Count)"
Write-Host "  Gruplar     : $($groups.Count)"
Write-Host "  Etiketler   : $($tags.Count)"
Write-Host "  Itemlar     : $($items.Count)"
Write-Host "  Diyagramlar : 3"
Write-Host ""
Write-Host "  Test kullanicilari:" -ForegroundColor Yellow
Write-Host "    devops_lead  / DevOpsLead2026Xz   (write+read)"
Write-Host "    sre_engineer / SREEngineer2026Xz  (write+read)"
Write-Host "    sec_auditor  / SecAuditor2026Xz   (read)"
Write-Host "    qa_engineer  / QAEngineer2026Xz   (read)"
Write-Host ""
Write-Host "  Uygulama: http://localhost:5175" -ForegroundColor Cyan
Write-Host ""
