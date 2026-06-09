// ============================================================================
// IronStock — Release Pipeline (Helm + ArgoCD GitOps)
// ----------------------------------------------------------------------------
// Kod    : github.com/GameOfAI/IronStock        (bu repo — Jenkinsfile burada)
// GitOps : github.com/GameOfAI/ironstock-k8s     (Helm chart + ArgoCD app manifest)
// Registry: Harbor (bilgeadam-harbor.bilgeadam.com/ironstock/<svc>)
// Secrets : argocd-vault-plugin + HashiCorp Vault (kv-v2/ironstock/<env>/<svc>)
// ============================================================================
pipeline {
    agent { label 'buildserver211' }

    parameters {
        string(
            name: 'BRANCH',
            defaultValue: 'main',
            description: 'Deploy edilecek branch (ornek: main, develop, feature/xyz). Ortam branch\'ten belirlenir.'
        )
        choice(
            name: 'SERVICE',
            choices: [
                'CHANGE_DRIVEN',
                'RELEASE_ALL',
                'api',
                'web'
            ],
            description: '''CHANGE_DRIVEN: Git degisikliklerini analiz ederek otomatik deploy (varsayilan)
RELEASE_ALL: Tum servisleri sirasiyla deploy et (major release/ilk kurulum)
Diger: Sadece secilen servisi deploy et (Targeted Mode - hotfix icin)'''
        )
        string(
            name: 'VERSION_PREFIX',
            defaultValue: '0.1',
            description: 'Semver major.minor on eki. Image + Helm chart versiyonu: <VERSION_PREFIX>.<BUILD_NUMBER>'
        )
    }

    environment {
        REGISTRY          = "${env.HARBOR_URL}"          // bilgeadam-harbor.bilgeadam.com
        REPO_NAME         = "ironstock"
        DOCKER_BUILDKIT   = "1"

        ARGOCD_SERVER     = "bacluster-argocd.opthemateknoloji.com"   // scheme'siz host (argocd CLI boyle ister)
        ARGOCD_PROJECT    = "ironstock"
        ARGOCD_BRANCH     = "main"
        ARGOCD_REPO_NAME  = "ironstock-k8s-repository"

        GITHUB_ORG        = "GameOfAI"
        GITHUB_CODE_REPO  = "IronStock"
        GITHUB_K8S_REPO   = "ironstock-k8s"
        K8S_REPO_DIR      = "ironstock-k8s"
    }

    options {
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '10'))
        disableConcurrentBuilds()
        timeout(time: 90, unit: 'MINUTES')
    }

    stages {

        // ================================================================
        // STAGE 1: Ortam ve Servis Tanimlari
        // ================================================================
        stage('Initialize') {
            steps {
                script {
                    // ── Servis Registry ──
                    //   name | changePath | dockerfile | port | helmChart
                    //   NOT: build context her zaman repo root (.) — Dockerfile.prod'lar
                    //        server/ + web/ + shared/ + package.json'i repo root'tan kopyaliyor.
                    env.SERVICE_DEFINITIONS = """
                        api|server|server/Dockerfile.prod|8080|api
                        web|web|web/Dockerfile.prod|80|web
                    """.trim()

                    // ── Branch secimi: parametre > otomatik tespit ──
                    def branchParam = params.BRANCH?.trim() ?: ''
                    def branchName = branchParam ?: env.BRANCH_NAME ?: env.GIT_BRANCH?.replaceAll('origin/', '') ?: 'main'

                    if (branchParam && branchParam != 'main') {
                        echo "Secilen branch checkout ediliyor: ${branchParam}"
                        def checkoutStatus = sh(
                            script: "git checkout -B '${branchParam}' 'origin/${branchParam}'",
                            returnStatus: true
                        )
                        if (checkoutStatus != 0) {
                            echo "origin/${branchParam} bulunamadi, credential ile fetch deneniyor..."
                            withCredentials([string(credentialsId: 'github-pat', variable: 'GH_TOKEN')]) {
                                sh """
                                    git fetch 'https://x-access-token:\${GH_TOKEN}@github.com/${GITHUB_ORG}/${GITHUB_CODE_REPO}.git' '${branchParam}'
                                    git checkout -B '${branchParam}' FETCH_HEAD
                                """
                            }
                        }
                    }

                    // ── Ortam Branch'ten Belirlenir ──
                    if (branchName in ['main', 'master', 'develop', 'test']) {
                        env.DEPLOY_ENV = "test"
                    } else if (branchName in ['stage', 'staging'] || branchName.startsWith('release/')) {
                        env.DEPLOY_ENV = "stage"
                    } else if (branchName in ['prod', 'production']) {
                        env.DEPLOY_ENV = "prod"
                    } else {
                        env.DEPLOY_ENV = "test"
                    }

                    // Namespace: prod -> "ironstock" (bare), digerleri -> "ironstock-<env>"
                    env.ARGOCD_NAMESPACE = (env.DEPLOY_ENV == "prod") ? "ironstock" : "ironstock-${env.DEPLOY_ENV}"
                    env.VALUES_FILE = "values-${env.DEPLOY_ENV}.yaml"
                    env.TAG = "${params.VERSION_PREFIX}.${env.BUILD_NUMBER}"
                    env.K8S_REPO_URL = "https://github.com/${GITHUB_ORG}/${GITHUB_K8S_REPO}.git"

                    def serviceParam = params.SERVICE ?: 'CHANGE_DRIVEN'
                    if (serviceParam == 'CHANGE_DRIVEN') {
                        env.DEPLOY_MODE = 'change_driven'
                    } else if (serviceParam == 'RELEASE_ALL') {
                        env.DEPLOY_MODE = 'release_all'
                    } else {
                        env.DEPLOY_MODE = 'targeted'
                        env.TARGET_SERVICE = serviceParam
                    }

                    echo """
                    ============================================================
                    IronStock - Release Pipeline
                    ============================================================
                    Branch       : ${branchName}
                    Environment  : ${env.DEPLOY_ENV}
                    Namespace    : ${env.ARGOCD_NAMESPACE}
                    SERVICE      : ${serviceParam}
                    Deploy Mode  : ${env.DEPLOY_MODE}
                    Image/Chart  : ${env.TAG}
                    ============================================================
                    """
                }
            }
        }

        // ================================================================
        // STAGE 2: Degisiklik Tespiti
        // ================================================================
        stage('Detect Changes') {
            steps {
                script {
                    def servicesToDeploy = []
                    def allServices = env.SERVICE_DEFINITIONS.trim().split('\n').collect { it.trim() }

                    switch (env.DEPLOY_MODE) {

                        case 'change_driven':
                            def changedFiles = []
                            def baseCommit = ''
                            try {
                                sh 'git fetch --unshallow 2>/dev/null || true'
                                baseCommit = env.GIT_PREVIOUS_SUCCESSFUL_COMMIT ?: ''
                                echo "DEBUG: GIT_PREVIOUS_SUCCESSFUL_COMMIT = '${baseCommit}'"

                                if (baseCommit) {
                                    def commitExists = sh(
                                        script: "git cat-file -t ${baseCommit} 2>/dev/null",
                                        returnStatus: true
                                    ) == 0
                                    if (commitExists) {
                                        def changes = sh(
                                            script: "git diff --name-only ${baseCommit} HEAD",
                                            returnStdout: true
                                        ).trim()
                                        changedFiles = changes ? changes.split('\n').toList() : []
                                    } else {
                                        echo "UYARI: Base commit repo'da yok. Tum servisler build edilecek."
                                        servicesToDeploy = allServices
                                    }
                                } else {
                                    echo "UYARI: Onceki basarili build commit bilgisi yok. Tum servisler build edilecek."
                                    servicesToDeploy = allServices
                                }
                            } catch (e) {
                                echo "Git diff basarisiz, tum servisler build edilecek: ${e.message}"
                                servicesToDeploy = allServices
                            }

                            if (servicesToDeploy.isEmpty() && !changedFiles.isEmpty()) {
                                echo "Degisen dosyalar (${changedFiles.size()}):"
                                changedFiles.each { echo "  -> ${it}" }

                                // Shared dosyalar degistiyse tum servisleri build et
                                def sharedChanged = changedFiles.any { file ->
                                    file.startsWith('shared/') ||
                                    file == 'go.work' ||
                                    file == 'go.work.sum' ||
                                    file == 'package.json' ||
                                    file == 'package-lock.json'
                                }

                                if (sharedChanged) {
                                    echo "Shared dosyalar degisti -> TUM servisler build edilecek"
                                    servicesToDeploy = allServices
                                } else {
                                    for (def svcLine : allServices) {
                                        def parts = svcLine.split('\\|')
                                        def svcName = parts[0]
                                        def changePath = parts[1]
                                        def hasChanges = changedFiles.any { it.startsWith(changePath + '/') }
                                        if (hasChanges) {
                                            servicesToDeploy.add(svcLine)
                                            echo "Degisiklik tespit edildi: ${svcName} (${changePath})"
                                        }
                                    }
                                }
                            }

                            if (servicesToDeploy.isEmpty()) {
                                echo "Hicbir serviste degisiklik tespit edilmedi. Pipeline sonlandiriliyor."
                                env.SKIP_DEPLOY = "true"
                            }
                            break

                        case 'targeted':
                            def targetLine = allServices.find { it.startsWith("${env.TARGET_SERVICE}|") }
                            if (targetLine) {
                                servicesToDeploy.add(targetLine)
                                echo "Hedef servis: ${env.TARGET_SERVICE}"
                            } else {
                                error "Gecersiz servis adi: ${env.TARGET_SERVICE}"
                            }
                            break

                        case 'release_all':
                            servicesToDeploy = allServices
                            echo "Tum servisler build ve deploy edilecek (${servicesToDeploy.size()} servis)"
                            break
                    }

                    env.SERVICES_TO_DEPLOY = servicesToDeploy.join('\n')
                    env.DEPLOY_COUNT = servicesToDeploy.size().toString()

                    echo "Deploy edilecek servisler (${env.DEPLOY_COUNT}):"
                    servicesToDeploy.each { line ->
                        def parts = line.split('\\|')
                        echo "  ${parts[0]} -> ${REGISTRY}/${REPO_NAME}/${parts[0]}:${TAG}"
                    }
                }
            }
        }

        // ================================================================
        // STAGE 3: K8s (GitOps) Repository Clone
        // ================================================================
        stage('Clone K8s Repository') {
            when {
                expression { env.SKIP_DEPLOY != "true" && env.DEPLOY_COUNT.toInteger() > 0 }
            }
            steps {
                withCredentials([string(credentialsId: 'github-pat', variable: 'GH_TOKEN')]) {
                    sh '''
                        set -e
                        rm -rf ${K8S_REPO_DIR} || true
                        git clone --depth 1 --branch ${ARGOCD_BRANCH} \
                          https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_ORG}/${GITHUB_K8S_REPO}.git ${K8S_REPO_DIR}
                    '''
                }
            }
        }

        // ================================================================
        // STAGE 4: ArgoCD Setup (Proje + Repo + Root App)
        // ================================================================
        stage('Setup ArgoCD') {
            when {
                expression { env.SKIP_DEPLOY != "true" && env.DEPLOY_COUNT.toInteger() > 0 }
            }
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'argocd-credentials-for-bacluster',
                        usernameVariable: 'ARGOCD_USER',
                        passwordVariable: 'ARGOCD_PASS'
                    ),
                    string(credentialsId: 'github-pat', variable: 'GH_TOKEN')
                ]) {
                    script {
                        def loginTest = sh(
                            script: 'argocd login "$ARGOCD_SERVER" --username "$ARGOCD_USER" --password "$ARGOCD_PASS" --insecure --grpc-web 2>&1',
                            returnStatus: true
                        )
                        if (loginTest != 0) error "ArgoCD Login Failed!"
                    }

                    sh '''
                        set -e

                        # ArgoCD Project
                        if ! argocd proj get "$ARGOCD_PROJECT" --insecure --grpc-web > /dev/null 2>&1; then
                            echo "Creating ArgoCD project: ${ARGOCD_PROJECT}"
                            argocd proj create "$ARGOCD_PROJECT" \
                                --description "IronStock Credential Vault" \
                                --dest "https://kubernetes.default.svc,ironstock" \
                                --dest "https://kubernetes.default.svc,ironstock-*" \
                                --dest "https://kubernetes.default.svc,argocd" \
                                --src "$K8S_REPO_URL" \
                                --insecure --grpc-web
                            argocd proj allow-cluster-resource "$ARGOCD_PROJECT" "*" "*" --insecure --grpc-web
                            argocd proj allow-namespace-resource "$ARGOCD_PROJECT" "*" "*" --insecure --grpc-web
                        else
                            echo "ArgoCD project exists: ${ARGOCD_PROJECT}"
                        fi

                        # Repository (GitHub PAT ile)
                        REPO_EXISTS=$(argocd repo list --insecure --grpc-web | grep -c "$K8S_REPO_URL" || true)
                        if [ "$REPO_EXISTS" -eq 0 ]; then
                            echo "Adding repository to ArgoCD..."
                            argocd repo add "$K8S_REPO_URL" \
                                --name "$ARGOCD_REPO_NAME" \
                                --username "x-access-token" \
                                --password "$GH_TOKEN" \
                                --project "$ARGOCD_PROJECT" \
                                --insecure --grpc-web
                        else
                            echo "Repository exists in ArgoCD"
                        fi

                        # Root application (app-of-apps)
                        if [ -f "${K8S_REPO_DIR}/root-ironstock.yaml" ]; then
                            argocd app create -f "${K8S_REPO_DIR}/root-ironstock.yaml" --upsert --insecure --grpc-web
                            echo "Root application ensured"
                        fi
                    '''
                }
            }
        }

        // ================================================================
        // STAGE 5: Build & Push Images
        // ================================================================
        stage('Build & Push Images') {
            when {
                expression { env.SKIP_DEPLOY != "true" && env.DEPLOY_COUNT.toInteger() > 0 }
            }
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'harbor-credentials',
                        usernameVariable: 'HARBOR_USER',
                        passwordVariable: 'HARBOR_PASS'
                    )
                ]) {
                    script {
                        sh """
                            echo "\${HARBOR_PASS}" | docker login "${REGISTRY}" -u "\${HARBOR_USER}" --password-stdin
                        """

                        def services = env.SERVICES_TO_DEPLOY.trim().split('\n')
                        def buildResults = [:]

                        for (def svcLine : services) {
                            def parts = svcLine.trim().split('\\|')
                            def svcName    = parts[0]
                            def dockerfile = parts[2]

                            def fullImage = "${REGISTRY}/${REPO_NAME}/${svcName}:${TAG}"

                            echo """
                            ----------------------------------------
                            Building: ${svcName}
                            Image   : ${fullImage}
                            Dockerfile: ${dockerfile}  (context: repo root)
                            ----------------------------------------"""

                            def buildStatus = sh(
                                script: """
                                    set -e
                                    export DOCKER_BUILDKIT=1
                                    docker build \
                                        --build-arg BUILDKIT_INLINE_CACHE=1 \
                                        -t "${fullImage}" \
                                        -f "${dockerfile}" \
                                        .
                                    docker push "${fullImage}"
                                    echo "${svcName} -> ${fullImage} pushed"
                                """,
                                returnStatus: true
                            )

                            buildResults[svcName] = (buildStatus == 0) ? 'SUCCESS' : 'FAILED'
                        }

                        def failedBuilds = buildResults.findAll { it.value == 'FAILED' }
                        env.BUILD_RESULTS = buildResults.collect { "${it.key}:${it.value}" }.join(',')

                        echo "Build Sonuclari:"
                        buildResults.each { svc, status -> echo "  ${svc}: ${status}" }

                        if (failedBuilds.size() > 0) {
                            error "${failedBuilds.size()} servis build'i basarisiz: ${failedBuilds.keySet().join(', ')}"
                        }
                    }
                }
            }
        }

        // ================================================================
        // STAGE 6: Helm Versiyonlama (image tag + chart version + appVersion)
        // ================================================================
        stage('Update Helm Values & Chart Version') {
            when {
                expression { env.SKIP_DEPLOY != "true" && env.DEPLOY_COUNT.toInteger() > 0 }
            }
            steps {
                withCredentials([string(credentialsId: 'github-pat', variable: 'GH_TOKEN')]) {
                    script {
                        def services = env.SERVICES_TO_DEPLOY.trim().split('\n')

                        sh """
                            cd ${K8S_REPO_DIR}
                            git config user.email "jenkins@bilgeadam.com"
                            git config user.name "Jenkins CI"
                        """

                        def updatedCharts = []

                        for (def svcLine : services) {
                            def parts = svcLine.trim().split('\\|')
                            def svcName   = parts[0]
                            def helmChart = parts[4]

                            echo "Versiyonlama: ${helmChart} -> ${TAG} (${VALUES_FILE})"

                            def updateStatus = sh(
                                script: """
                                    set -e
                                    cd ${K8S_REPO_DIR}

                                    if [ -f "${helmChart}/${VALUES_FILE}" ]; then
                                        # 1) image.tag guncelle
                                        sed -i "s|tag:.*|tag: ${TAG}|g" "${helmChart}/${VALUES_FILE}"

                                        # 2) Helm chart version + appVersion guncelle (her release versiyonlanir)
                                        sed -i "s|^version:.*|version: ${TAG}|" "${helmChart}/Chart.yaml"
                                        sed -i "s|^appVersion:.*|appVersion: \\"${TAG}\\"|" "${helmChart}/Chart.yaml"

                                        git add "${helmChart}/${VALUES_FILE}" "${helmChart}/Chart.yaml"
                                        echo "Updated: ${helmChart} (image+chart=${TAG})"
                                    else
                                        echo "Values file yok: ${helmChart}/${VALUES_FILE}, atlaniyor..."
                                    fi
                                """,
                                returnStatus: true
                            )
                            if (updateStatus == 0) updatedCharts.add(helmChart)
                        }

                        if (updatedCharts.size() > 0) {
                            def chartList = updatedCharts.join(', ')
                            sh """
                                cd ${K8S_REPO_DIR}
                                git commit -m "CI: release ${TAG} [${env.DEPLOY_ENV}] - ${chartList}" || echo "Nothing to commit"
                                git push https://x-access-token:\${GH_TOKEN}@github.com/${GITHUB_ORG}/${GITHUB_K8S_REPO}.git ${ARGOCD_BRANCH}
                                echo "Helm version push edildi: ${chartList}"
                            """
                        }
                    }
                }
            }
        }

        // ================================================================
        // STAGE 7: Helm Lint & Template (render dogrulama — commit sonrasi sanity)
        // ================================================================
        stage('Helm Lint & Template') {
            when {
                expression { env.SKIP_DEPLOY != "true" && env.DEPLOY_COUNT.toInteger() > 0 }
            }
            steps {
                script {
                    def services = env.SERVICES_TO_DEPLOY.trim().split('\n')
                    for (def svcLine : services) {
                        def parts = svcLine.trim().split('\\|')
                        def helmChart = parts[4]
                        echo "helm lint/template: ${helmChart}"
                        sh """
                            set -e
                            cd ${K8S_REPO_DIR}/${helmChart}
                            helm dependency build
                            helm lint -f ${VALUES_FILE} .
                            # Vault placeholder'lari plugin cozer; burada sadece render edilebilirligi dogruluyoruz.
                            helm template . -f ${VALUES_FILE} > /dev/null
                        """
                    }
                }
            }
        }

        // ================================================================
        // STAGE 8: ArgoCD Application Manifest Kontrolu
        // ================================================================
        stage('Ensure Application Manifests') {
            when {
                expression { env.SKIP_DEPLOY != "true" && env.DEPLOY_COUNT.toInteger() > 0 }
            }
            steps {
                withCredentials([string(credentialsId: 'github-pat', variable: 'GH_TOKEN')]) {
                    script {
                        def services = env.SERVICES_TO_DEPLOY.trim().split('\n')
                        def newManifests = []

                        sh """
                            cd ${K8S_REPO_DIR}
                            git config user.email "jenkins@bilgeadam.com"
                            git config user.name "Jenkins CI"
                        """

                        for (def svcLine : services) {
                            def parts = svcLine.trim().split('\\|')
                            def helmChart = parts[4]
                            def appName = "${helmChart}-${env.DEPLOY_ENV}"
                            def appFile = "applications/${appName}.yaml"

                            def exists = sh(
                                script: "test -f ${K8S_REPO_DIR}/${appFile} && echo 'yes' || echo 'no'",
                                returnStdout: true
                            ).trim()

                            if (exists == 'yes') {
                                echo "App manifest mevcut: ${appFile}"
                            } else {
                                echo "App manifest olusturuluyor: ${appFile}"
                                sh """
                                    cd ${K8S_REPO_DIR}
                                    TEMPLATE="applications/application-template.tpl"
                                    cp "\$TEMPLATE" "${appFile}"
                                    sed -i "s|__APP_NAME__|${appName}|g" "${appFile}"
                                    sed -i "s|__APP_PATH__|${helmChart}|g" "${appFile}"
                                    sed -i "s|__BRANCH__|${ARGOCD_BRANCH}|g" "${appFile}"
                                    sed -i "s|__VALUES_FILE__|${VALUES_FILE}|g" "${appFile}"
                                    sed -i "s|__TARGET_NAMESPACE__|${ARGOCD_NAMESPACE}|g" "${appFile}"
                                    git add "${appFile}"
                                """
                                newManifests.add(appName)
                            }
                        }

                        if (newManifests.size() > 0) {
                            sh """
                                cd ${K8S_REPO_DIR}
                                git commit -m "CI: add ArgoCD app manifests [${env.DEPLOY_ENV}] - ${newManifests.join(', ')}"
                                git push https://x-access-token:\${GH_TOKEN}@github.com/${GITHUB_ORG}/${GITHUB_K8S_REPO}.git ${ARGOCD_BRANCH}
                                echo "App manifests push edildi: ${newManifests.join(', ')}"
                            """
                        }
                    }
                }
            }
        }

        // ================================================================
        // STAGE 9: ArgoCD Sync
        // ================================================================
        stage('Sync ArgoCD') {
            when {
                expression { env.SKIP_DEPLOY != "true" && env.DEPLOY_COUNT.toInteger() > 0 }
            }
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'argocd-credentials-for-bacluster',
                        usernameVariable: 'ARGOCD_USER',
                        passwordVariable: 'ARGOCD_PASS'
                    )
                ]) {
                    script {
                        sh '''
                            argocd login ${ARGOCD_SERVER} \
                                --username ${ARGOCD_USER} \
                                --password ${ARGOCD_PASS} \
                                --insecure --grpc-web
                        '''

                        echo "Syncing root-ironstock (app-of-apps)..."
                        sh '''
                            argocd app sync "root-ironstock" \
                                --insecure --grpc-web --async \
                                || echo "WARN: root-ironstock sync failed, continuing..."
                        '''
                        sleep(time: 10, unit: 'SECONDS')

                        def services = env.SERVICES_TO_DEPLOY.trim().split('\n')
                        def syncResults = [success: [], failed: []]

                        for (def svcLine : services) {
                            def parts = svcLine.trim().split('\\|')
                            def helmChart = parts[4]
                            def appName = "${helmChart}-${env.DEPLOY_ENV}"
                            echo "Syncing ArgoCD app: ${appName}"
                            try {
                                sh """
                                    argocd app sync "${appName}" \
                                        --insecure --grpc-web --force --async \
                                        || echo "WARN: ${appName} sync trigger failed"
                                """
                                syncResults.success.add(appName)
                            } catch (Exception e) {
                                syncResults.failed.add(appName)
                                echo "Sync warning: ${appName} - ${e.message}"
                            }
                        }

                        env.SYNC_SUCCESS = syncResults.success.join(',')
                        env.SYNC_FAILED = syncResults.failed.join(',')
                        if (syncResults.failed.size() > 0) {
                            unstable("ArgoCD sync tetiklenemedi: ${syncResults.failed.join(', ')}")
                        }
                    }
                }
            }
        }

        // ================================================================
        // STAGE 10: Ozet
        // ================================================================
        stage('Summary') {
            when {
                expression { env.SKIP_DEPLOY != "true" && env.DEPLOY_COUNT.toInteger() > 0 }
            }
            steps {
                script {
                    def services = env.SERVICES_TO_DEPLOY.trim().split('\n')
                    echo """
                    ============================================================
                    IRONSTOCK - DEPLOYMENT SUMMARY
                    ============================================================
                    SERVICE      : ${params.SERVICE}
                    Deploy Mode  : ${env.DEPLOY_MODE}
                    Environment  : ${env.DEPLOY_ENV}
                    Namespace    : ${env.ARGOCD_NAMESPACE}
                    Image/Chart  : ${env.TAG}
                    Services     : ${env.DEPLOY_COUNT}
                    ============================================================"""
                    for (def svcLine : services) {
                        def parts = svcLine.trim().split('\\|')
                        echo "  ${parts[0]} -> ${parts[4]} @ ${env.TAG}"
                    }
                }
            }
        }
    }

    // ====================================================================
    // POST: Bildirim ve Temizlik
    // ====================================================================
    post {
        success {
            script {
                if (env.SKIP_DEPLOY == "true") {
                    echo "Degisiklik tespit edilmedi - pipeline atlandi"
                } else {
                    echo """IronStock Build SUCCESS
SERVICE     : ${params.SERVICE}
Environment : ${env.DEPLOY_ENV}
Version     : ${env.TAG}
Services    : ${env.DEPLOY_COUNT} deployed
Namespace   : ${env.ARGOCD_NAMESPACE}
Build Time  : ${currentBuild.durationString.replace(' and counting', '')}
"""
                }
            }
        }
        failure {
            script {
                echo """IronStock Build FAILURE
SERVICE     : ${params.SERVICE}
Environment : ${env.DEPLOY_ENV}
Stage       : ${env.STAGE_NAME}
Build Time  : ${currentBuild.durationString.replace(' and counting', '')}
"""
            }
        }
        always {
            script {
                if (env.SERVICES_TO_DEPLOY) {
                    def services = env.SERVICES_TO_DEPLOY.trim().split('\n')
                    for (def svcLine : services) {
                        def parts = svcLine.trim().split('\\|')
                        def svcName = parts[0]
                        sh "docker rmi '${REGISTRY}/${REPO_NAME}/${svcName}:${TAG}' || true"
                    }
                }
            }
            cleanWs()
        }
    }
}
