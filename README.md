# MeshCore map auto uploader

## Description
This bot will upload every repeater or room server to the map when companion hears new advert

## Requirements
You will need Meshcore device with Companion USB connected to your machine or Companion WiFi on the same network.

## Installation
1. [Install Node.js 22 or higher](https://nodejs.org/en/download/)(most recent LTS recommended)
2. Clone this repo & install dependencies via npm
```sh
git clone https://github.com/recrof/map.meshcore.dev-uploader
cd map.meshcore.dev-uploader
npm install .
```
### Usage
1. Connect working MeshCore companion usb into the computer
2. run `node index.mjs (usb_port)` or `node index.mjs (host:port)`

## Running with Docker
After cloning the repo, build and run the docker image with 
```sh
docker-compose build
docker-compose up
```
You will be able to inspect the logs. Once everything is working correctly, run the container with ``docker-compose up -d`` to run it in the background.

### Configuration in Docker
You can override default values with a .env file, such as:
```sh
# Set device to a wifi companion
DEVICE=192.168.10.74:5000
# Override timeout to 30 mins (if no adverts have been received within this time, the container will report unhealthy and restart automatically)
ADVERT_TIMEOUT_MS=1800000
```
## Running with Podman
To avoid running with priveledged mode, podman can be used to build and run this image.

The magic for avoiding prveledged is to add `--group-add keep-groups` to the `podman run` command. 

This blog post explains it well: https://www.nite07.com/en/posts/podman-group-share/
```sh
podman build . -f Dockerfile -t localhost/map-reporter

# Update the `-e DEVICE=` and `--device` lines below to match your meshcore
# usb companion usb device path.
podman run --restart=unless-stopped -d \
  --device /dev/ttyUSB0:/dev/ttyUSB0 \
  -e DEVICE=/dev/ttyUSB0 \
  --group-add keep-groups \
  --name meshcore-map-reporter \
  localhost/map-reporter
```

### Persist reboots
Since podman runs in the user context, it doesn't run a daemon by default like Docker does. To have your container start at boot time, we can leverage systemd to start podman at boot.

See Also: https://www.redhat.com/en/blog/container-systemd-persist-reboot
```sh
# Use the container that we created in the previous step as a template to generate the systemd unit file.
# No changes need to be made to the unit file
podman generate systemd --new --files --name meshcore-map-reporter
mkdir -p ~/.config/systemd/user/
cp -Z container-meshcore-map-reporter.service ~/.config/systemd/user
systemctl --user daemon-reload

# Stop and remove the template container
podman stop meshcore-map-reporter
podman rm meshcore-map-reporter

# Enable and start the container via systemd
systemctl --user enable container-meshcore-map-reporter.service
systemctl --user start container-meshcore-map-reporter.service
```

### View logs
```sh
journalctl --user -efu container-meshcore-map-reporter

or

podman logs -f meshcore-map-reporter
```
### Updating
1. Build the container image with the same tag
2. Restart the systemd service: `systemctl --user restart container-meshcore-map-reporter.service`
