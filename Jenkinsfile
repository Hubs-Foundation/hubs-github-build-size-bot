pipeline {
  agent any
  options {
    ansiColor('xterm') 
  }
  stages {
    stage('build-size'){
      steps {
        writeFile(file:'payload.json', text:"${payload}")
        sh "cp job/package-lock.json ."
        sh "cp job/package.json ."
        sh "/usr/bin/script --return -c 'sudo /usr/bin/hab-docker-studio run /bin/bash job/build-size.sh ${github_bot_token}' /dev/null" 
      }
    }
  }
}
