// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { LambdaRestApiProps, RestApi } from "aws-cdk-lib/aws-apigateway";
import {
  AllowedMethods,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  DistributionProps,
  IOrigin,
  OriginRequestPolicy,
  OriginSslPolicy,
  OriginAccessIdentity,
  PriceClass,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin, S3Origin, OriginGroup } from "aws-cdk-lib/aws-cloudfront-origins";
import { Policy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Runtime, Architecture, LayerVersion } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { IBucket, Bucket } from "aws-cdk-lib/aws-s3";
import { ArnFormat, Aws, Duration, Lazy, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CloudFrontToApiGatewayToLambda } from "@aws-solutions-constructs/aws-cloudfront-apigateway-lambda";

import { addCfnSuppressRules } from "../../utils/utils";
import { SolutionConstructProps } from "../types";
import * as api from "aws-cdk-lib/aws-apigateway";

export interface BackEndProps extends SolutionConstructProps {
  readonly solutionVersion: string;
  readonly solutionId: string;
  readonly solutionName: string;
  readonly secretsManagerPolicy: Policy;
  readonly logsBucket: IBucket;
  readonly uuid: string;
  readonly cloudFrontPriceClass: string;
  readonly createSourceBucketsResource: (key?: string) => string[];
  // readonly createSourceBucketsResource2: (key?: string) => any;
  readonly production: boolean;
}

export class BackEnd extends Construct {
  public domainName: string;
  public stage: string;

  constructor(scope: Construct, id: string, props: BackEndProps) {
    super(scope, id);
    this.stage = props.production ? "prod" : "dev";

    const imageHandlerLambdaFunctionRole = new Role(this, `ImageHandlerFunctionRole`, {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      path: "/",
    });
    props.secretsManagerPolicy.attachToRole(imageHandlerLambdaFunctionRole);

    const imageHandlerLambdaFunctionRolePolicy = new Policy(this, `ImageHandlerFunctionPolicy`, {
      statements: [
        new PolicyStatement({
          actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
          resources: [
            Stack.of(this).formatArn({
              service: "logs",
              resource: "log-group",
              resourceName: "/aws/lambda/*",
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            }),
          ],
        }),
        new PolicyStatement({
          //update the policy to allow the lambda function to put items
          actions: ["s3:GetObject"],
          resources: props.createSourceBucketsResource("/*"),
        }),
        new PolicyStatement({
          //update the policy to allow the lambda function to put items
          actions: ["s3:PutObject", "s3:PutObjectAcl"],
          resources: [`arn:aws:s3:::${props.storageBucket}/*`],
        }),
        new PolicyStatement({
          actions: ["s3:ListBucket"],
          resources: props.createSourceBucketsResource(),
        }),
        new PolicyStatement({
          actions: ["s3:GetObject"],
          resources: [`arn:aws:s3:::${props.fallbackImageS3Bucket}/${props.fallbackImageS3KeyBucket}`],
        }),
        new PolicyStatement({
          actions: ["rekognition:DetectFaces", "rekognition:DetectModerationLabels"],
          resources: ["*"],
        }),
      ],
    });

    addCfnSuppressRules(imageHandlerLambdaFunctionRolePolicy, [
      { id: "W12", reason: "rekognition:DetectFaces requires '*' resources." },
    ]);
    imageHandlerLambdaFunctionRole.attachInlinePolicy(imageHandlerLambdaFunctionRolePolicy);

    const imageHandlerLambdaFunction = new NodejsFunction(this, `ImageHandlerLambdaFunction-${this.stage}`, {
      description: `${props.solutionName} (${this.stage}-${props.solutionVersion}): Performs image edits and manipulations`,
      memorySize: 1024,
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(29),
      role: imageHandlerLambdaFunctionRole,
      entry: path.join(__dirname, "../../../image-handler/index.ts"),
      environment: {
        AUTO_WEBP: props.autoWebP,
        CORS_ENABLED: props.corsEnabled,
        CORS_ORIGIN: props.corsOrigin,
        SOURCE_BUCKETS: props.sourceBuckets,
        STORAGE_BUCKET: props.storageBucket,
        REWRITE_MATCH_PATTERN: "",
        REWRITE_SUBSTITUTION: "",
        ENABLE_SIGNATURE: props.enableSignature,
        SECRETS_MANAGER: props.secretsManager,
        SECRET_KEY: props.secretsManagerKey,
        ENABLE_DEFAULT_FALLBACK_IMAGE: props.enableDefaultFallbackImage,
        DEFAULT_FALLBACK_IMAGE_BUCKET: props.fallbackImageS3Bucket,
        DEFAULT_FALLBACK_IMAGE_KEY: props.fallbackImageS3KeyBucket,
        SOLUTION_VERSION: props.solutionVersion,
        SOLUTION_ID: props.solutionId,
      },
      bundling: {
        externalModules: ["sharp", "canvas"],
        nodeModules: ["sharp", "canvas"],
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string): string[] {
            return [];
          },
          beforeInstall(inputDir: string, outputDir: string): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            return [`cd ${outputDir}`, "rm -rf node_modules/sharp  && npm install --arch=x64 --platform=linux sharp", "rm -rf node_modules/canvas"];
          },
        },
      },
      layers: [
        LayerVersion.fromLayerVersionArn(this, 'nodejs-canvas-layer', 'arn:aws:lambda:ap-south-1:109689457092:layer:canvas-nodejs:1')
      ]
    });

    const imageHandlerLogGroup = new LogGroup(this, `ImageHandlerLogGroup-${this.stage}`, {
      logGroupName: `/aws/lambda/${imageHandlerLambdaFunction.functionName}`,
      retention: props.logRetentionPeriod as RetentionDays,
    });

    addCfnSuppressRules(imageHandlerLogGroup, [
      {
        id: "W84",
        reason: "CloudWatch log group is always encrypted by default.",
      },
    ]);

    const cachePolicy = new CachePolicy(this, "CachePolicy", {
      cachePolicyName: `ServerlessImageHandler-${this.stage}-${props.uuid}`,
      defaultTtl: Duration.days(1),
      minTtl: Duration.seconds(1),
      maxTtl: Duration.days(365),
      enableAcceptEncodingGzip: false,
      headerBehavior: CacheHeaderBehavior.allowList("origin"),
      queryStringBehavior: CacheQueryStringBehavior.allowList("signature"),
    });

    const originRequestPolicy = new OriginRequestPolicy(this, "OriginRequestPolicy", {
      originRequestPolicyName: `ServerlessImageHandler-${this.stage}-${props.uuid}`,
      headerBehavior: CacheHeaderBehavior.allowList("origin"),
      queryStringBehavior: CacheQueryStringBehavior.allowList("signature"),
    });

    const apiGatewayRestApi = RestApi.fromRestApiId(
      this,
      "ApiGatewayRestApi",
      Lazy.string({
        produce: () => imageHandlerCloudFrontApiGatewayLambda.apiGateway.restApiId,
      })
    );

    // Add S3 origin
    // Reference an existing S3 bucket by its name
    // HARD CODING THIS BUCKET
    // Origin Access Identity
    const originAccessIdentity = new OriginAccessIdentity(this, 'OAI');
    const processedImageBucket = Bucket.fromBucketName(this, 'ExistingBucket', props.storageBucket);
    const s3Origin = new S3Origin(processedImageBucket, {
      originAccessIdentity: originAccessIdentity,
    });
    // Grant the CloudFront OAI access to the S3 bucket
    processedImageBucket.addToResourcePolicy(new PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${processedImageBucket.bucketArn}/*`],
      principals: [originAccessIdentity.grantPrincipal],
    }));

    // Add API Gateway origin
    const apiGatewayOrigin: IOrigin = new HttpOrigin(`${apiGatewayRestApi.restApiId}.execute-api.${Aws.REGION}.amazonaws.com`, {
      originSslProtocols: [OriginSslPolicy.TLS_V1_1, OriginSslPolicy.TLS_V1_2],
      originPath: `/image`,
    });

    // Create an origin group
    const originGroup = new OriginGroup({
      primaryOrigin: s3Origin,
      fallbackOrigin: apiGatewayOrigin,
      fallbackStatusCodes: [400, 403, 404, 416, 500, 502, 503, 504],
    });

    const cloudFrontDistributionProps: DistributionProps = {
      comment: "Image Handler Distribution for Serverless Image Handler",
      defaultBehavior: {
        origin: originGroup,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
        originRequestPolicy,
        cachePolicy,
      },
      priceClass: props.cloudFrontPriceClass as PriceClass,
      enableLogging: true,
      logBucket: props.logsBucket,
      logFilePrefix: "api-cloudfront/",
      errorResponses: [
        { httpStatus: 500, ttl: Duration.minutes(10) },
        { httpStatus: 501, ttl: Duration.minutes(10) },
        { httpStatus: 502, ttl: Duration.minutes(10) },
        { httpStatus: 503, ttl: Duration.minutes(10) },
        { httpStatus: 504, ttl: Duration.minutes(10) },
      ],
    };

    const logGroupProps = {
      retention: props.logRetentionPeriod as RetentionDays,
    };

    const apiGatewayProps: LambdaRestApiProps = {
      handler: imageHandlerLambdaFunction,
      deployOptions: {
        stageName: "image",
      },
      binaryMediaTypes: ["*/*"],
      defaultMethodOptions: {
        authorizationType: api.AuthorizationType.NONE,
      },
    };

    const imageHandlerCloudFrontApiGatewayLambda = new CloudFrontToApiGatewayToLambda(
      this,
      "ImageHandlerCloudFrontApiGatewayLambda",
      {
        existingLambdaObj: imageHandlerLambdaFunction,
        insertHttpSecurityHeaders: false,
        logGroupProps,
        cloudFrontDistributionProps,
        apiGatewayProps,
      }
    );

    addCfnSuppressRules(imageHandlerCloudFrontApiGatewayLambda.apiGateway, [
      {
        id: "W59",
        reason:
          "AWS::ApiGateway::Method AuthorizationType is set to 'NONE' because API Gateway behind CloudFront does not support AWS_IAM authentication",
      },
    ]);

    imageHandlerCloudFrontApiGatewayLambda.apiGateway.node.tryRemoveChild("Endpoint"); // we don't need the RestApi endpoint in the outputs

    this.domainName = imageHandlerCloudFrontApiGatewayLambda.cloudFrontWebDistribution.distributionDomainName;
  }
}
