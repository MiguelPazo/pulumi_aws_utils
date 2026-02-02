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
    ): Promise<LambdaFailoverResult> {
        const lambdaFullName = `${this.config.generalPrefixShort}-failover`;

        /**
         * Create Lambda Role with Policy
         */
        const policyJson: pulumi.Output<string> = pulumi.all([snsArn]).apply(([sns]) => {
            return fs.readFileSync(__dirname + '/../resources/lambdas/failover/policy.json', 'utf8')
                .replace(/rep_region/g, this.config.region)
                .replace(/rep_accountid/g, accountId)
                .replace(/rep_sns_arn/g, sns)
                .replace(/rep_log_grup/g, lambdaFullName);
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
            tags: {
                ...this.config.generalTags,
                Name: `${lambdaFullName}-lambda`,
            }
        }, {
            dependsOn: [logGroup]
        });

        return {
            lambdaFunction,
            lambdaRole,
            logGroup
        };
    }
}

export {LambdaFailover}
