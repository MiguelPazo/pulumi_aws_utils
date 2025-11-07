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
    ): Promise<void> {
        const lambdaFullName = `${this.config.generalPrefix}-${config.lambdaName}-lambda`;

        /**
         * Create Lambda Role with Policy
         */
        const policyJson: pulumi.Output<string> | any = pulumi.all([this.config.accountId]).apply(([accountId]) => {
            let policyStr = fs.readFileSync(__dirname + '/../resources/lambdas/lambda_restart/policy.json', 'utf8')
                .replace(/rep_region/g, aws.config.region)
                .replace(/rep_accountid/g, accountId)
                .replace(/rep_log_grup/g, lambdaFullName);

            return Promise.resolve(JSON.parse(policyStr));
        });

        const lambdaRole = await LambdaRole.getInstance().main(
            {name: config.lambdaName},
            null,
            policyJson
        );

        /**
         * Create CloudWatch Log Group for Lambda
         */
        new aws.cloudwatch.LogGroup(`${this.config.project}-${config.lambdaName}-loggroup`, {
            name: `/aws/lambda/${lambdaFullName}`,
            retentionInDays: this.config.cloudwatchRetentionLogs,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${config.lambdaName}-loggroup`,
            }
        });

        /**
         * Create Lambda Function
         */
        const lambdaFunction = new aws.lambda.Function(`${this.config.project}-${config.lambdaName}-lambda`, {
            name: lambdaFullName,
            runtime: aws.lambda.Runtime.Python3d12,
            handler: "main.lambda_handler",
            role: lambdaRole.arn,
            code: new pulumi.asset.AssetArchive({
                "main.py": new pulumi.asset.FileAsset(__dirname + '/../resources/lambdas/lambda_restart/main.py')
            }),
            timeout: 60,
            memorySize: 128,
            vpcConfig: {
                subnetIds: vpc.privateSubnetIds,
                securityGroupIds: securityGroups.map(sg => sg.id)
            },
            environment: {
                variables: {
                    LOG_LEVEL: "INFO"
                }
            },
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${config.lambdaName}-lambda`,
            }
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
