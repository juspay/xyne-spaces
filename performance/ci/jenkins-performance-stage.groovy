// Copy the parameters into the existing declarative pipeline's `parameters` block.
// Copy the stage after the selected environment's deploy + readiness + fixture-reset stages.
// The operational Jenkinsfile is not stored in this checkout, so its owner must perform that wiring.

parameters {
  booleanParam(
    name: 'RUN_PERFORMANCE_TESTS',
    defaultValue: false,
    description: 'Run the post-deployment k6 stage'
  )
  choice(name: 'PERF_ENVIRONMENT', choices: ['sandbox', 'preprod'], description: 'Safe target')
  choice(
    name: 'PERF_PROFILE',
    choices: ['smoke', 'release', 'load', 'stress', 'soak'],
    description: 'Traffic profile; load/stress/soak are preprod-only'
  )
  choice(
    name: 'PERF_SCENARIO',
    choices: ['zero-query-transform', 'rest-messaging', 'smoke'],
    description: 'zero-query-transform reads (ACL/AST only); rest-messaging writes rows'
  )
  string(name: 'PERF_VUS_OVERRIDE', defaultValue: '', description: 'Optional bounded VU override')
  string(
    name: 'PERF_DURATION_OVERRIDE',
    defaultValue: '',
    description: 'Optional steady duration such as 10m'
  )
  string(
    name: 'PERF_ZERO_MAX_REQUESTS',
    defaultValue: '',
    description: 'Only if the target raised ZERO_MAX_REQUESTS; relaxes the identity-count guard'
  )
  booleanParam(
    name: 'PERF_ENFORCE_THRESHOLDS',
    defaultValue: false,
    description: 'Enable only after 3-5 approved baseline runs'
  )
}

stage('Performance and load test') {
  when {
    expression { params.RUN_PERFORMANCE_TESTS }
  }
  // Ceiling, not a target: preprod permits an 8h steady duration, so anything past this
  // is a hung container rather than a long run, and must not hold the agent.
  options {
    timeout(time: 9, unit: 'HOURS')
  }
  environment {
    PERF_ENVIRONMENT = "${params.PERF_ENVIRONMENT}"
    PERF_PROFILE = "${params.PERF_PROFILE}"
    PERF_SCENARIO = "${params.PERF_SCENARIO}"
    PERF_VUS_OVERRIDE = "${params.PERF_VUS_OVERRIDE}"
    PERF_DURATION_OVERRIDE = "${params.PERF_DURATION_OVERRIDE}"
    PERF_ENFORCE_THRESHOLDS = "${params.PERF_ENFORCE_THRESHOLDS}"
    PERF_ZERO_MAX_REQUESTS = "${params.PERF_ZERO_MAX_REQUESTS}"
    PERF_RELEASE_VERSION = "${env.GIT_COMMIT}"
  }
  steps {
    script {
      String target = params.PERF_ENVIRONMENT
      withCredentials([
        string(
          credentialsId: "xyne-perf-${target}-base-url",
          variable: 'PERF_BASE_URL'
        ),
        file(
          credentialsId: "xyne-perf-${target}-users-json",
          variable: 'PERF_USERS_FILE'
        ),
        string(
          credentialsId: 'xyne-perf-victoriametrics-write-url',
          variable: 'PERF_REMOTE_WRITE_URL'
        ),
        usernamePassword(
          credentialsId: 'xyne-perf-victoriametrics-writer',
          usernameVariable: 'PERF_REMOTE_WRITE_USERNAME',
          passwordVariable: 'PERF_REMOTE_WRITE_PASSWORD'
        )
      ]) {
        sh(label: 'Validate performance framework', script: 'pnpm perf:validate')
        sh(label: 'Run selected k6 profile', script: 'pnpm perf:run')
      }
    }
  }
  post {
    always {
      archiveArtifacts(
        artifacts: 'performance/reports/**/*',
        allowEmptyArchive: true,
        fingerprint: true
      )
    }
  }
}
