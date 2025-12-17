/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import * as fs from 'fs';

class Ssm {
    private static __instance: Ssm;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Ssm {
        if (this.__instance == null) {
            this.__instance = new Ssm();
        }

        return this.__instance;
    }

    async main(
        ec2Role: pulumi.Output<aws.iam.Role>,
        logGroupKmsKey: pulumi.Output<aws.kms.Key>,
    ): Promise<void> {
        /**
         * S3
         */
        const bucketSsmLogsName = pulumi.interpolate`${this.config.generalPrefix}-${this.config.accountId}-ssm-logs`;

        const bucketSsmLogs = new aws.s3.Bucket(`${this.config.project}-ssm-bucket`, {
            bucket: bucketSsmLogsName,
            acl: "private",
            tags: {
                ...this.config.generalTags,
                Name: bucketSsmLogsName,
            }
        });

        new aws.s3.BucketOwnershipControls(`${this.config.project}-ssm-bucket-ownership`, {
            bucket: bucketSsmLogs.id,
            rule: {
                objectOwnership: "ObjectWriter",
            },
        });

        new aws.s3.BucketServerSideEncryptionConfigurationV2(`${this.config.project}-ssm-bucket-encrypt`, {
            bucket: bucketSsmLogs.id,
            rules: [{
                applyServerSideEncryptionByDefault: {
                    sseAlgorithm: "AES256",
                },
            }],
        });

        new aws.s3.BucketLifecycleConfigurationV2(`${this.config.project}-ssm-bucket-lifecycle`, {
            bucket: bucketSsmLogs.id,
            rules: [{
                id: "rule-expiration",
                status: "Enabled",
                filter: {
                    prefix: "",
                },
                expiration: {
                    days: 90,
                },
            }],
        });

        new aws.s3.BucketPolicy(`${this.config.project}-ssm-bucket-policy`, {
            bucket: bucketSsmLogs.id,
            policy: pulumi.output(bucketSsmLogs.arn).apply(x => {
                return JSON.stringify({
                    "Version": "2012-10-17",
                    "Statement": [
                        {
                            "Sid": "RequireSSL",
                            "Effect": "Deny",
                            "Principal": "*",
                            "Action": "s3:*",
                            "Resource": [
                                x,
                                `${x}/*`
                            ],
                            "Condition": {
                                "Bool": {
                                    "aws:SecureTransport": "false"
                                }
                            }
                        }
                    ]
                })
            })
        });

        /**
         * CloudWatch
         */
        const logGroupName = `/aws/ssm/${this.config.generalPrefix}`;

        new aws.cloudwatch.LogGroup(`${this.config.project}-ssm-loggroup`, {
            name: logGroupName,
            retentionInDays: this.config.cloudwatchRetentionLogs,
            kmsKeyId: logGroupKmsKey.arn,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-ssm-loggroup`,
            }
        });

        /**
         * SSM Document
         */
        new aws.ssm.Document(`${this.config.project}-ssm-document`, {
            name: 'SSM-SessionManagerRunShell',
            documentType: 'Session',
            documentFormat: 'JSON',
            content: pulumi.output(bucketSsmLogs.bucket).apply(x => {
                return JSON.stringify({
                    "schemaVersion": "1.0",
                    "description": "Document to hold regional settings for Session Manager",
                    "sessionType": "Standard_Stream",
                    "inputs": {
                        "s3BucketName": x,
                        "s3KeyPrefix": "session_manager/",
                        "s3EncryptionEnabled": true,
                        "cloudWatchLogGroupName": logGroupName,
                        "cloudWatchEncryptionEnabled": false
                    }
                })
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-ssm-document`,
            }
        });

        /**
         * IAM
         */
        let policyJson = pulumi.all([bucketSsmLogs.bucket]).apply(data => {
            let policyStr = fs.readFileSync(__dirname + '/../resources/ec2/ssm.json', 'utf8')
                .replace(/rep_bucket_name/g, data[0]);

            return Promise.resolve(JSON.parse(policyStr));
        });

        const policySsm = new aws.iam.Policy(`${this.config.project}-policy-ssm`, {
            name: `${this.config.generalPrefix}-policy-ssm`,
            path: "/",
            description: "Policy for login with SSM in EC2",
            policy: policyJson,
            tags: this.config.generalTags
        });

        new aws.iam.RolePolicyAttachment(`${this.config.project}-ssm-role-attach`, {
            role: ec2Role.name,
            policyArn: policySsm.arn,
        });
    }
}

export {Ssm}
