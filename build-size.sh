rm /usr/bin/env
ln -s "$(hab pkg path core/coreutils)/bin/env" /usr/bin/env
hab pkg install -b core/node10 core/git 
npm ci
DEBUG=build-size GITHUB_TOKEN=$1 node bot/build-size.js
