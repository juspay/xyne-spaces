// Jenkinsfile — daily GitHub repo insights (stars, forks, watchers, open issues, etc.)
// and upload the JSON report to a GCS bucket.

pipeline {
    agent any

    options {
        buildDiscarder(logRotator(numToKeepStr: '30'))
        disableConcurrentBuilds()
        timestamps()
        timeout(time: 15, unit: 'MINUTES')
    }

    parameters {
        string(name: 'REPO_OWNER', defaultValue: 'juspay', description: 'GitHub organisation or user that owns the repo')
        string(name: 'REPO_NAME', defaultValue: 'xyne-spaces', description: 'GitHub repository name')
        string(name: 'GCS_BUCKET', defaultValue: 'gs://xyne-spaces-analytics/reports/', description: 'Destination GCS path (must end with /)')
        string(name: 'GITHUB_TOKEN_CREDENTIAL_ID', defaultValue: 'github-api-token', description: 'Jenkins credentials ID for the GitHub personal-access token (Secret text). Required for private repos; optional for public repos.')
        string(name: 'GCP_SA_KEY_CREDENTIAL_ID', defaultValue: 'gcp-service-account-key', description: 'Jenkins credentials ID for the GCP service-account JSON key (Secret file)')
    }

    triggers {
        // Daily at 02:00 server time.
        cron('H 2 * * *')
    }

    stages {
        stage('Fetch GitHub insights') {
            steps {
                withCredentials([string(credentialsId: params.GITHUB_TOKEN_CREDENTIAL_ID, variable: 'GITHUB_TOKEN')]) {
                    sh '''
                        set -euo pipefail
                        mkdir -p reports

                        python3 - <<'PY'
import json
import os
import urllib.request
import datetime

owner = os.environ.get('REPO_OWNER', 'juspay')
repo = os.environ.get('REPO_NAME', 'xyne-spaces')
token = os.environ.get('GITHUB_TOKEN', '')
url = f'https://api.github.com/repos/{owner}/{repo}'

req = urllib.request.Request(
    url,
    headers={
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'xyne-spaces-jenkins-insights',
    },
)
if token:
    req.add_header('Authorization', f'Bearer {token}')

with urllib.request.urlopen(req, timeout=30) as resp:
    data = json.loads(resp.read().decode('utf-8'))

insight_fields = [
    'full_name', 'description', 'html_url', 'created_at', 'updated_at',
    'pushed_at', 'stargazers_count', 'watchers_count', 'forks_count',
    'open_issues_count', 'network_count', 'subscribers_count', 'size', 'language',
]
report = {
    'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'source': url,
    'repository': {k: data[k] for k in insight_fields if k in data},
}

ts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
report_path = f'reports/repo-insights-{ts}.json'
with open(report_path, 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2)

print(f'Wrote {report_path}')
print(json.dumps(report['repository'], indent=2))
PY
                    '''
                }
            }
        }

        stage('Upload to GCS') {
            steps {
                withCredentials([file(credentialsId: params.GCP_SA_KEY_CREDENTIAL_ID, variable: 'GOOGLE_APPLICATION_CREDENTIALS')]) {
                    sh '''
                        set -euo pipefail

                        gcloud auth activate-service-account --key-file="${GOOGLE_APPLICATION_CREDENTIALS}"

                        REPORT_FILE=$(ls -t reports/repo-insights-*.json | head -n 1)
                        gcloud storage cp "${REPORT_FILE}" "${GCS_BUCKET}"

                        echo "Uploaded ${REPORT_FILE} to ${GCS_BUCKET}"
                    '''
                }
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'reports/repo-insights-*.json', allowEmptyArchive: true
        }
        failure {
            echo 'Repo insights collection or GCS upload failed. Check the console logs.'
        }
    }
}
