/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as fs from 'fs';
import {InitConfig} from "../types/module";
import {getInit} from "../config";
import {LambdaRole} from "../modules/LambdaRole";
import {LambdaRestartConfig, VpcImportResult} from "../types";


class LambdaRestart {
    private static __instance: LambdaRestart;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): LambdaRestart {
        if (this.__instance == null) {
            this.__instance = new LambdaRestart();
        }

        return this.__instance;
    }

    async main(
        config: LambdaRestartConfig,
        vpc: pulumi.Output<VpcImportResult>,
        securityGroups: pulumi.Output<aws.ec2.SecurityGroup>[],
        cwLogsKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
        lambdaKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
        enableParamsSecure?: boolean,
        ssmKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
    ): Promise<void> {
        const lambdaFullName = `${this.config.generalPrefix}-${config.lambdaName}-lambda`;
        const paramStorePath = `/${this.config.project}/${this.config.stack}/general/lambda/${config.lambdaName}`;

        /**
         * Create SSM Parameter Store for environment variables (if enabled)
         */
        let ssmParameter: aws.ssm.Parameter | undefined;
        if (enableParamsSecure && ssmKmsKey) {
            ssmParameter = new aws.ssm.Parameter(`${this.config.project}-${config.lambdaName}-params`, {
                name: paramStorePath,
                type: "SecureString",
                keyId: pulumi.output(ssmKmsKey).apply(key => key.id),
                value: JSON.stringify({
                    LOG_LEVEL: "INFO"
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
            this.config.accountId,
            ssmKmsKey ? pulumi.output(ssmKmsKey).apply(key => key.arn) : pulumi.output(undefined)
        ]).apply(([accountId, ssmKmsArn]) => {
            let policyStr = fs.readFileSync(__dirname + '/../resources/lambdas/lambda_restart/policy.json', 'utf8')
                .replace(/rep_region/g, aws.config.region)
                .replace(/rep_accountid/g, accountId)
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
                    Resource: `arn:aws:ssm:${aws.config.region}:${accountId}:parameter${paramStorePath}`
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
            {name: config.lambdaName},
            null,
            policyJson
        );

        /**
         * Create CloudWatch Log Group for Lambda
         */
        const logGroup = new aws.cloudwatch.LogGroup(`${this.config.project}-${config.lambdaName}-loggroup`, {
            name: `/aws/lambda/${lambdaFullName}`,
            retentionInDays: this.config.cloudwatchRetentionLogs,
            kmsKeyId: cwLogsKmsKey ? pulumi.output(cwLogsKmsKey).apply(key => key.arn) : undefined,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${config.lambdaName}-loggroup`,
            }
        });

        /**
         * Create Lambda Function
         */
        const lambdaDependencies: pulumi.Resource[] = [logGroup];
        if (ssmParameter) {
            lambdaDependencies.push(ssmParameter);
        }

        const lambdaFunction = new aws.lambda.Function(`${this.config.project}-${config.lambdaName}-lambda`, {
            name: lambdaFullName,
            runtime: aws.lambda.Runtime.NodeJS22dX,
            handler: "index.handler",
            role: lambdaRole.arn,
            code: new pulumi.asset.AssetArchive({
                "index.mjs": new pulumi.asset.FileAsset(__dirname + '/../resources/lambdas/lambda_restart/index.mjs')
            }),
            timeout: 60,
            memorySize: 128,
            kmsKeyArn: lambdaKmsKey ? pulumi.output(lambdaKmsKey).apply(key => key.arn) : undefined,
            vpcConfig: {
                subnetIds: vpc.privateSubnetIds,
                securityGroupIds: securityGroups.map(sg => sg.id)
            },
            environment: enableParamsSecure ? {
                variables: {
                    PARAM_STORE_PATH: paramStorePath
                }
            } : {
                variables: {
                    LOG_LEVEL: "INFO"
                }
            },
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${config.lambdaName}-lambda`,
            }
        }, {
            dependsOn: lambdaDependencies
        });

        /**
         * Create EventBridge Rule
         */
        const eventRule = new aws.cloudwatch.EventRule(`${this.config.project}-${config.lambdaName}-ebrule`, {
            name: `${this.config.generalPrefixShort}-${config.lambdaName}-ebrule`,
            description: `Scheduled rule to restart ECS service: ${config.eventData.service_name}`,
            scheduleExpression: config.cronExpression,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-${config.lambdaName}-ebrule`,
            }
        });

        /**
         * Create EventBridge Target
         */
        new aws.cloudwatch.EventTarget(`${this.config.project}-${config.lambdaName}-ebrule-target`, {
            rule: eventRule.name,
            arn: lambdaFunction.arn,
            input: JSON.stringify(config.eventData)
        });

        /**
         * Grant EventBridge permission to invoke Lambda
         */
        new aws.lambda.Permission(`${this.config.project}-${config.lambdaName}-ebrule-permission`, {
            statementId: "AllowExecutionFromEventBridge",
            action: "lambda:InvokeFunction",
            function: lambdaFunction.name,
            principal: "events.amazonaws.com",
            sourceArn: eventRule.arn
        });
    }
}

export {LambdaRestart}
