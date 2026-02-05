/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {InitConfig} from "../types/module";
import {getInit} from "../config";
import {LambdaRole} from "../modules/LambdaRole";
import {General} from "../common/General";

export type LambdaNotificationsResult = {
    lambdaFunction: aws.lambda.Function;
    lambdaRole: aws.iam.Role;
    logGroup: aws.cloudwatch.LogGroup;
    snsSubscription: aws.sns.TopicSubscription;
};

class LambdaNotifications {
    private static __instance: LambdaNotifications;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): LambdaNotifications {
        if (this.__instance == null) {
            this.__instance = new LambdaNotifications();
        }

        return this.__instance;
    }

    async main(
        accountId: string,
        snsArn: pulumi.Input<string>,
        slackWebhookUrl: pulumi.Input<string>,
        cwLogsKmsKey: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
        lambdaKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
        enableParamsSecure?: boolean,
        ssmKmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>,
    ): Promise<LambdaNotificationsResult> {
        const lambdaFullName = `${this.config.generalPrefixShort}-lambda-notifications`;
        const paramStorePath = `/${this.config.project}/${this.config.stack}/general/lambda/lambda-notifications`;

        /**
         * Create SSM Parameter Store for environment variables (if enabled)
         */
        let ssmParameter: aws.ssm.Parameter | undefined;
        if (enableParamsSecure && ssmKmsKey) {
            ssmParameter = new aws.ssm.Parameter(`${this.config.project}-lambda-notifications-params`, {
                name: paramStorePath,
                type: "SecureString",
                keyId: pulumi.output(ssmKmsKey).apply(key => key.id),
                value: pulumi.all([slackWebhookUrl]).apply(([webhook]) => {
                    return JSON.stringify({
                        SLACK_WEBHOOK_URL: webhook
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
            accountId,
            ssmKmsKey ? pulumi.output(ssmKmsKey).apply(key => key.arn) : pulumi.output(undefined)
        ]).apply(([accId, ssmKmsArn]) => {
            // Render policy using General.renderPolicy with additional context
            const policyFilePath = __dirname + '/../resources/lambdas/lambda_notifications/policy.json';
            const policyOutput = General.renderTemplate(policyFilePath, {
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
                        Resource: `arn:aws:ssm:${this.config.region}:${accId}:parameter${paramStorePath}`
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
        });

        const lambdaRole = await LambdaRole.getInstance().main(
            {name: 'lambda-notifications'},
            null,
            policyJson
        );

        /**
         * Create CloudWatch Log Group for Lambda
         */
        const logGroup = new aws.cloudwatch.LogGroup(`${this.config.project}-lambda-notifications-loggroup`, {
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

        const lambdaFunction = new aws.lambda.Function(`${this.config.project}-lambda-notifications`, {
            name: lambdaFullName,
            description: "Lambda for sending notifications to Slack",
            runtime: aws.lambda.Runtime.NodeJS22dX,
            handler: "index.handler",
            role: lambdaRole.arn,
            code: new pulumi.asset.AssetArchive({
                "index.mjs": new pulumi.asset.FileAsset(__dirname + '/../resources/lambdas/lambda_notifications/index.mjs')
            }),
            timeout: 60,
            memorySize: 128,
            kmsKeyArn: lambdaKmsKey ? pulumi.output(lambdaKmsKey).apply(key => key.arn) : undefined,
            environment: enableParamsSecure ? {
                variables: {
                    PARAM_STORE_PATH: paramStorePath
                }
            } : {
                variables: {
                    SLACK_WEBHOOK_URL: slackWebhookUrl
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
         * Grant SNS permission to invoke Lambda
         */
        new aws.lambda.Permission(`${this.config.project}-lambda-notifications-sns-permission`, {
            statementId: "AllowExecutionFromSNS",
            action: "lambda:InvokeFunction",
            function: lambdaFunction.name,
            principal: "sns.amazonaws.com",
            sourceArn: snsArn
        });

        /**
         * Subscribe Lambda to SNS Topic
         */
        const snsSubscription = new aws.sns.TopicSubscription(`${this.config.project}-lambda-notifications-subscription`, {
            topic: snsArn,
            protocol: "lambda",
            endpoint: lambdaFunction.arn
        });

        return {
            lambdaFunction,
            lambdaRole,
            logGroup,
            snsSubscription
        };
    }
}

export {LambdaNotifications}
