// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { ServerlessImageHandlerStack } from "../lib/serverless-image-stack";

// CDK and default deployment
let synthesizer = new DefaultStackSynthesizer({
  generateBootstrapVersionRule: false,
});

// Solutions pipeline deployment
const { DIST_OUTPUT_BUCKET, SOLUTION_NAME, VERSION } = process.env;
if (DIST_OUTPUT_BUCKET && SOLUTION_NAME && VERSION)
  synthesizer = new DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
    fileAssetsBucketName: `${DIST_OUTPUT_BUCKET}-\${AWS::Region}`,
    bucketPrefix: `${SOLUTION_NAME}/${VERSION}/`,
  });

const app = new App();
const solutionDisplayName = "Serverless Image Handler Dev";
const solutionVersion = VERSION ?? app.node.tryGetContext("solutionVersion");
const description = `(${app.node.tryGetContext("solutionId")}) - ${solutionDisplayName}. Dev Version ${solutionVersion}`;
// eslint-disable-next-line no-new


/**
 * overrideWarningsEnabled=false npx cdk deploy \
  --parameters DeployDemoUIParameter=No \
  --parameters SourceBucketsParameter=relata-dev \
  --parameters StorageBucketParameter=relata-dev \
  --parameters CorsEnabledParameter=Yes \
  --parameters CorsOriginParameter="*" \
  --parameters ProductionParameter=No \
  --parameters EnableDefaultFallbackImageParameter=Yes \
  --parameters FallbackImageS3BucketParameter=relata-dev \
  --parameters FallbackImageS3KeyParameter=utils/fallback.webp
 */
// new ServerlessImageHandlerStack(app, "ServerlessImageHandlerStack-Dev", {
//   synthesizer,
//   description,
//   solutionId: app.node.tryGetContext("solutionId"),
//   solutionVersion,
//   solutionName: app.node.tryGetContext("solutionName"),
// });


/**
 * overrideWarningsEnabled=false npx cdk deploy \
  --parameters DeployDemoUIParameter=No \
  --parameters SourceBucketsParameter=relata-prod \
  --parameters StorageBucketParameter=relata-prod \
  --parameters CorsEnabledParameter=Yes \
  --parameters CorsOriginParameter="*" \
  --parameters ProductionParameter=Yes \
  --parameters EnableDefaultFallbackImageParameter=Yes \
  --parameters FallbackImageS3BucketParameter=relata-prod \
  --parameters FallbackImageS3KeyParameter=utils/fallback.webp
 */
// new ServerlessImageHandlerStack(app, "serverless-image-handler-prod", {
//   synthesizer,
//   description,
//   solutionId: app.node.tryGetContext("solutionId"),
//   solutionVersion,
//   solutionName: app.node.tryGetContext("solutionName"),
// });


