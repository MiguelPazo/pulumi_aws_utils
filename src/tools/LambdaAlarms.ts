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
        snsKmsKey: pulumi.Input<aws.kms.Key>,
        cwLogsKmsKey: pulumi.Input<aws.kms.Key>,
    ): Promise<LambdaAlarmsResult> {
        const lambdaFullName = `${this.config.generalPrefixShort}-lambda-alarms`;

        /**
         * Create Lambda Role with Policy
         */
        const policyJson: pulumi.Output<string> | any = pulumi.all([
            pulumi.output(snsArn),
            pulumi.output(snsKmsKey).apply(key => key.arn)
        ]).apply(([arn, kmsArn]) => {
            let policyStr = fs.readFileSync(__dirname + '/../resources/lambdas/lambda_alarms/policy.json', 'utf8')
                .replace(/rep_region/g, this.config.region)
                .replace(/rep_accountid/g, accountId)
                .replace(/rep_log_grup/g, lambdaFullName)
                .replace(/rep_sns_arn/g, arn as string)
                .replace(/rep_kms_key_arn/g, kmsArn as string);

            return Promise.resolve(JSON.parse(policyStr));
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
            environment: {
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
            dependsOn: [logGroup]
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
