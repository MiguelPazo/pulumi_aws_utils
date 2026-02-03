/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as fs from 'fs';
import {InitConfig} from "../types/module";
import {getInit} from "../config";
import {LambdaRole} from "../modules/LambdaRole";

export type LambdaFailoverResult = {
    lambdaFunction: aws.lambda.Function;
    lambdaRole: aws.iam.Role;
    logGroup: aws.cloudwatch.LogGroup;
};

class LambdaFailover {
    private static __instance: LambdaFailover;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): LambdaFailover {
        if (this.__instance == null) {
            this.__instance = new LambdaFailover();
        }

        return this.__instance;
    }

    async main(
        accountId: string,
        snsArn: pulumi.Output<string>,
        cwLogsKmsKey: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
        lambdaKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
        enableParamsSecure?: boolean,
        ssmKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
    ): Promise<LambdaFailoverResult> {
        const lambdaFullName = `${this.config.generalPrefixShort}-failover`;
        const paramStorePath = `/${this.config.project}/${this.config.stack}/general/lambda/failover`;

        /**
         * Create SSM Parameter Store for environment variables (if enabled)
         */
        let ssmParameter: aws.ssm.Parameter | undefined;
        if (enableParamsSecure && ssmKmsKey) {
            ssmParameter = new aws.ssm.Parameter(`${this.config.project}-failover-params`, {
                name: paramStorePath,
                type: "SecureString",
                keyId: pulumi.output(ssmKmsKey).apply(key => key.id),
                value: JSON.stringify({
                    REGION: this.config.region
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
        const policyJson: pulumi.Output<string> = pulumi.all([
            snsArn,
            ssmKmsKey ? pulumi.output(ssmKmsKey).apply(key => key.arn) : pulumi.output(undefined)
        ]).apply(([sns, ssmKmsArn]) => {
            let policyStr = fs.readFileSync(__dirname + '/../resources/lambdas/failover/policy.json', 'utf8')
                .replace(/rep_region/g, this.config.region)
                .replace(/rep_accountid/g, accountId)
                .replace(/rep_sns_arn/g, sns)
                .replace(/rep_log_grup/g, lambdaFullName);

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

            return policyStr;
        });

        const lambdaRole = await LambdaRole.getInstance().main(
            {name: 'failover'},
            null,
            policyJson
        );

        /**
         * Create CloudWatch Log Group for Lambda
         */
        const logGroup = new aws.cloudwatch.LogGroup(`${this.config.project}-failover-loggroup`, {
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

        const lambdaFunction = new aws.lambda.Function(`${this.config.project}-failover`, {
            name: lambdaFullName,
            description: "Lambda for multi-region failover operations",
            runtime: aws.lambda.Runtime.NodeJS22dX,
            handler: "index.handler",
            role: lambdaRole.arn,
            code: new pulumi.asset.AssetArchive({
                "index.mjs": new pulumi.asset.FileAsset(__dirname + '/../resources/lambdas/failover/index.mjs')
            }),
            timeout: 900,
            memorySize: 512,
            kmsKeyArn: lambdaKmsKey ? pulumi.output(lambdaKmsKey).apply(key => key.arn) : undefined,
            environment: enableParamsSecure ? {
                variables: {
                    PARAM_STORE_PATH: paramStorePath
                }
            } : undefined,
            tags: {
                ...this.config.generalTags,
                Name: `${lambdaFullName}-lambda`,
            }
        }, {
            dependsOn: lambdaDependencies
        });

        return {
            lambdaFunction,
            lambdaRole,
            logGroup
        };
    }
}

export {LambdaFailover}
