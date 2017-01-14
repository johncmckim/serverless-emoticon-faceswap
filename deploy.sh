#!/bin/bash
set -e

SERVICE_ENV=$1

if [ -z ${AWS_REGION+x} ]; then
  echo "Please set a region";
  exit 0;
fi

if [ -z ${SERVICE_ENV+x} ]; then
  echo "Please set service environment SERVICE_ENV";
  exit 0;
fi

echo "Deploying to stage $SERVICE_ENV"


# use the serverless version installed in the project
./node_modules/.bin/sls deploy --stage $SERVICE_ENV --region $AWS_REGION --verbose

