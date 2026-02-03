/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as fs from 'fs';
import {InitConfig} from "../types/module";
import {getInit} from "../config";
import {LambdaRole} from "../modules/LambdaRole";

export type LambdaAlarmsResult = {
    lambdaFunction: aws.lambda.Function;
    lambdaRole: aws.iam.Role;
    logGroup: aws.cloudwatch.LogGroup;
};

class LambdaAlarms {
    private static __instance: LambdaAlarms;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): LambdaAlarms {
        if (this.__instance == null) {
            this.__instance = new LambdaAlarms();
        }

        return this.__instance;
    }

    async main(
        accountId: string,
        snsArn: pulumi.Input<string>,
        snsKmsKey: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
        cwLogsKmsKey: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
        lambdaKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
        enableParamsSecure?: boolean,
        ssmKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
    ): Promise<LambdaAlarmsResult> {
        const lambdaFullName = `${this.config.generalPrefixShort}-lambda-alarms`;
        const paramStorePath = `/${this.config.project}/${this.config.stack}/general/lambda/lambda-alarms`;

        /**
         * Create SSM Parameter Store for environment variables (if enabled)
         */
        let ssmParameter: aws.ssm.Parameter | undefined;
        if (enableParamsSecure && ssmKmsKey) {
            ssmParameter = new aws.ssm.Parameter(`${this.config.project}-lambda-alarms-params`, {
                name: paramStorePath,
                type: "SecureString",
                keyId: pulumi.output(ssmKmsKey).apply(key => key.id),
                value: pulumi.all([snsArn]).apply(([sns]) => {
                    return JSON.stringify({
                        REGION: this.config.region,
                        SNS_TOPIC_ARN: sns
                    });
                }),
                tags: {
                    ...this.config.generalTags,
                    Name: `${lambdaFullName}-params`,
                }
            });
        }

        /**
         * Create Lambda Role with Policy
         */
        const policyJson: pulumi.Output<string> | any = pulumi.all([
            pulumi.output(snsArn),
            pulumi.output(snsKmsKey).apply(key => key.arn),
            ssmKmsKey ? pulumi.output(ssmKmsKey).apply(key => key.arn) : pulumi.output(undefined)
        ]).apply(([arn, kmsArn, ssmKmsArn]) => {
            let policyStr = fs.readFileSync(__dirname + '/../resources/lambdas/lambda_alarms/policy.json', 'utf8')
                .replace(/rep_region/g, this.config.region)
                .replace(/rep_accountid/g, accountId)
                .replace(/rep_log_grup/g, lambdaFullName)
                .replace(/rep_sns_arn/g, arn as string)
                .replace(/rep_kms_key_arn/g, kmsArn as string);

            const policy = JSON.parse(policyStr);

            // Add SSM permissions if secure params are enabled
            if (enableParamsSecure && ssmKmsArn) {
                policy.Statement.push({
                    Effect: "Allow",
                    Action: [
                        "ssm:GetParameter",
                        "ssm:GetParameters"
                    ],
                    Resource: `arn:aws:ssm:${this.config.region}:${accountId}:parameter${paramStorePath}`
                });
                policy.Statement.push({
                    Effect: "Allow",
                    Action: [
                        "kms:Decrypt",
                        "kms:GenerateDataKey"
                    ],
                    Resource: ssmKmsArn
                });
            }

            return Promise.resolve(policy);
        });

        const lambdaRole = await LambdaRole.getInstance().main(
            {name: 'lambda-alarms'},
            null,
            policyJson
        );

        /**
         * Create CloudWatch Log Group for Lambda
         */
        const logGroup = new aws.cloudwatch.LogGroup(`${this.config.project}-lambda-alarms-loggroup`, {
            name: `/aws/lambda/${lambdaFullName}`,
            retentionInDays: this.config.cloudwatchRetentionLogs,
            kmsKeyId: pulumi.output(cwLogsKmsKey).apply(key => key.arn),
            tags: {
                ...this.config.generalTags,
                Name: `${lambdaFullName}-log-group`,
            }
        });

        /**
         * Create Lambda Function
         */
        const lambdaDependencies: pulumi.Resource[] = [logGroup];
        if (ssmParameter) {
            lambdaDependencies.push(ssmParameter);
        }

        const lambdaFunction = new aws.lambda.Function(`${this.config.project}-lambda-alarms`, {
            name: lambdaFullName,
            description: "Lambda for processing CloudWatch alarms",
            runtime: aws.lambda.Runtime.NodeJS22dX,
            handler: "index.handler",
            role: lambdaRole.arn,
            code: new pulumi.asset.AssetArchive({
                "index.mjs": new pulumi.asset.FileAsset(__dirname + '/../resources/lambdas/lambda_alarms/index.mjs')
            }),
            timeout: 600,
            memorySize: 128,
            kmsKeyArn: lambdaKmsKey ? pulumi.output(lambdaKmsKey).apply(key => key.arn) : undefined,
            environment: enableParamsSecure ? {
                variables: {
                    PARAM_STORE_PATH: paramStorePath
                }
            } : {
                variables: {
                    REGION: this.config.region,
                    SNS_TOPIC_ARN: snsArn
                }
            },
            tags: {
                ...this.config.generalTags,
                Name: `${lambdaFullName}-lambda`,
            }
        }, {
            dependsOn: lambdaDependencies
        });

        /**
         * Grant CloudWatch Alarms permission to invoke Lambda
         */
        new aws.lambda.Permission(`${this.config.project}-lambda-alarms-cw-permission`, {
            statementId: "AllowExecutionFromCloudWatchAlarms",
            action: "lambda:InvokeFunction",
            function: lambdaFunction.name,
            principal: "lambda.alarms.cloudwatch.amazonaws.com",
            sourceAccount: accountId
        });

        return {
            lambdaFunction,
            lambdaRole,
            logGroup
        };
    }
}

export {LambdaAlarms}
