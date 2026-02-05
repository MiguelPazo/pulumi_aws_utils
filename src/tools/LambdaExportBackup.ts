/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {InitConfig} from "../types/module";
import {getInit} from "../config";
import {LambdaRole} from "../modules/LambdaRole";
import {General} from "../common/General";

export type LambdaExportBackupResult = {
    lambdaFunction: aws.lambda.Function;
    lambdaRole: aws.iam.Role;
    logGroup: aws.cloudwatch.LogGroup;
};

class LambdaExportBackup {
    private static __instance: LambdaExportBackup;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): LambdaExportBackup {
        if (this.__instance == null) {
            this.__instance = new LambdaExportBackup();
        }

        return this.__instance;
    }

    async main(
        accountId: string,
        bucketName: pulumi.Output<string>,
        snsArn: pulumi.Output<string>,
        cwLogsKmsKey: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
        lambdaKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
        enableParamsSecure?: boolean,
        ssmKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
    ): Promise<LambdaExportBackupResult> {
        const lambdaFullName = `${this.config.generalPrefixShort}-export-backup`;
        const paramStorePath = `/${this.config.project}/${this.config.stack}/general/lambda/export-backup`;

        /**
         * Create SSM Parameter Store for environment variables (if enabled)
         */
        let ssmParameter: aws.ssm.Parameter | undefined;
        if (enableParamsSecure && ssmKmsKey) {
            ssmParameter = new aws.ssm.Parameter(`${this.config.project}-export-backup-params`, {
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
            bucketName,
            snsArn,
            ssmKmsKey ? pulumi.output(ssmKmsKey).apply(key => key.arn) : pulumi.output(undefined)
        ]).apply(([bucket, sns, ssmKmsArn]) => {
            // Render policy using General.renderPolicy with additional context
            const policyFilePath = __dirname + '/../resources/lambdas/export_backup/policy.json';
            const policyOutput = General.renderTemplate(policyFilePath, {
                bucketName: bucket,
                snsArn: sns,
                logGroup: lambdaFullName
            });

            return policyOutput.apply(policy => {
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

                return JSON.stringify(policy);
            });
        });

        const lambdaRole = await LambdaRole.getInstance().main(
            {name: 'export-backup'},
            null,
            policyJson
        );

        /**
         * Create CloudWatch Log Group for Lambda
         */
        const logGroup = new aws.cloudwatch.LogGroup(`${this.config.project}-export-backup-loggroup`, {
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

        const lambdaFunction = new aws.lambda.Function(`${this.config.project}-export-backup`, {
            name: lambdaFullName,
            description: "Unified Lambda for CloudWatch Logs export operations",
            runtime: aws.lambda.Runtime.NodeJS22dX,
            handler: "index.handler",
            role: lambdaRole.arn,
            code: new pulumi.asset.AssetArchive({
                "index.mjs": new pulumi.asset.FileAsset(__dirname + '/../resources/lambdas/export_backup/index.mjs')
            }),
            timeout: 900,
            memorySize: 256,
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

export {LambdaExportBackup}
