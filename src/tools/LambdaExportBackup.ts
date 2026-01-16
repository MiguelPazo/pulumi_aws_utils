/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as fs from 'fs';
import {InitConfig} from "../types/module";
import {getInit} from "../config";
import {LambdaRole} from "../modules/LambdaRole";

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
        cwLogsKmsKey: pulumi.Input<aws.kms.Key>,
    ): Promise<LambdaExportBackupResult> {
        const lambdaFullName = `${this.config.generalPrefixShort}-export-backup`;

        /**
         * Create Lambda Role with Policy
         */
        const policyJson: pulumi.Output<string> = pulumi.all([bucketName, snsArn]).apply(([bucket, sns]) => {
            return fs.readFileSync(__dirname + '/../resources/lambdas/export_backup/policy.json', 'utf8')
                .replace(/rep_region/g, this.config.region)
                .replace(/rep_accountid/g, accountId)
                .replace(/rep_bucket_name/g, bucket)
                .replace(/rep_sns_arn/g, sns)
                .replace(/rep_log_grup/g, lambdaFullName);
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

export {LambdaExportBackup}
