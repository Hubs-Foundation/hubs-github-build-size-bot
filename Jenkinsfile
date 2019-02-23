pipeline {
  agent any
  options {
    ansiColor('xterm') 
  }
  stages {
    stage('build-size'){
      steps {
        writeFile(file:'payload.json', text:"${payload}")
        sh "/usr/bin/script --return -c 'sudo /usr/bin/hab-docker-studio -k mozillareality run /bin/bash build-size.sh ${github_bot_token}' /dev/null" 
      }
    }
  }
}
