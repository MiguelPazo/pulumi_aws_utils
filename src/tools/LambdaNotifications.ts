/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as fs from 'fs';
import {InitConfig} from "../types/module";
import {getInit} from "../config";
import {LambdaRole} from "../modules/LambdaRole";

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
        snsArn: pulumi.Input<string>,
        slackWebhookUrl: pulumi.Input<string>,
        accountId: string
    ): Promise<LambdaNotificationsResult> {
        const lambdaFullName = `${this.config.generalPrefixShort}-lambda-notifications`;

        /**
         * Create Lambda Role with Policy
         */
        const policyJson: pulumi.Output<string> | any = pulumi.all([accountId]).apply(([accId]) => {
            let policyStr = fs.readFileSync(__dirname + '/../resources/lambdas/lambda_notifications/policy.json', 'utf8')
                .replace(/rep_region/g, this.config.region)
                .replace(/rep_accountid/g, accId)
                .replace(/rep_log_grup/g, lambdaFullName);

            return Promise.resolve(JSON.parse(policyStr));
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
            tags: {
                ...this.config.generalTags,
                Name: `${lambdaFullName}-log-group`,
            }
        });

        /**
         * Create Lambda Function
         */
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
            environment: {
                variables: {
                    SLACK_WEBHOOK_URL: slackWebhookUrl
                }
            },
            tags: {
                ...this.config.generalTags,
                Name: `${lambdaFullName}-lambda`,
            }
        }, {
            dependsOn: [logGroup]
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
