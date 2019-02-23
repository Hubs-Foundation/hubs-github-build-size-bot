pipeline {
  agent any
  options {
    ansiColor('xterm') 
  }
  stages {
    stage('build-size'){
      steps {
        writeFile(file:'payload.json', text:"${payload}")
        echo pwd
        sh "echo $PWD"
        sh "mv build-size.sh .."
        sh "mv build-size.js .."
        sh "/usr/bin/script --return -c 'sudo /usr/bin/hab-docker-studio -k mozillareality run /bin/bash build-size.sh ${github_bot_token}' /dev/null" 
      }
    }
  }
}
