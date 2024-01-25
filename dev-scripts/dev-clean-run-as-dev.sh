#!/bin/sh

if ! [ $(id -u) = 0 ]; then
   echo "Must run as sudo or root"
   exit 1
fi

pwd > currentdirectory
docker service rm $(docker service ls -q)
sleep 1s
docker secret rm captain-salt
docker build -t captain-debug -f dockerfile-captain.debug .
rm -rf /captain && mkdir /captain
chmod -R 777 /captain
docker run \
   -e "CAPTAIN_IS_DEBUG=1" \
   -e "MAIN_NODE_IP_ADDRESS=127.0.0.1" \
   -v /var/run/docker.sock:/var/run/docker.sock \
   -v /captain:/captain \
   -v $(pwd):/usr/src/app captain-debug
sleep 2s
docker service logs captain-captain --follow
