/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import {SqsConfig, SqsResult} from "../types";

class Sqs {
    private static __instance: Sqs;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Sqs {
        if (this.__instance == null) {
            this.__instance = new Sqs();
        }

        return this.__instance;
    }

    async main(
        sqsConfig: SqsConfig,
        kmsKey?: pulumi.Output<aws.kms.Key>
    ): Promise<SqsResult> {
        /**
         * KMS
         */
        const kms = kmsKey || new aws.kms.Key(`${this.config.project}-sqs-${sqsConfig.name}-kms`, {
            description: `${this.config.generalPrefix}-sqs-${sqsConfig.name}-kms`,
            deletionWindowInDays: 30,
            customerMasterKeySpec: 'SYMMETRIC_DEFAULT',
            enableKeyRotation: true,
            policy: pulumi.output(this.config.accountId).apply(x => {
                return JSON.stringify({
                    Version: "2012-10-17",
                    Statement: [
                        {
                            Sid: "EnableRootPermissions",
                            Effect: "Allow",
                            Principal: {
                                AWS: `arn:aws:iam::${x}:root`,
                            },
                            Action: "kms:*",
                            Resource: "*",
                        },
                        {
                            Sid: "AllowSQSUsage",
                            Effect: "Allow",
                            Principal: {
                                Service: "sqs.amazonaws.com",
                            },
                            Action: [
                                "kms:Encrypt",
                                "kms:Decrypt",
                                "kms:List",
                                "kms:ReEncrypt*",
                                "kms:GenerateDataKey*",
                                "kms:DescribeKey"
                            ],
                            Resource: "*",
                        }
                    ]
                })
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-sqs-${sqsConfig.name}-kms`
            }
        });

        if (!kmsKey) {
            new aws.kms.Alias(`${this.config.project}-sqs-${sqsConfig.name}-kms-alias`, {
                name: `alias/${this.config.generalPrefix}-sqs-${sqsConfig.name}-kms`,
                targetKeyId: kms.keyId
            });
        }

        /**
         * Dead Letter Queue (DLQ)
         */
        const dlqName = sqsConfig.fifoQueue
            ? `${this.config.generalPrefix}-sqs-${sqsConfig.name}-dlq.fifo`
            : `${this.config.generalPrefix}-sqs-${sqsConfig.name}-dlq`;

        const dlq = new aws.sqs.Queue(`${this.config.project}-sqs-${sqsConfig.name}-dlq`, {
            name: dlqName,
            kmsDataKeyReusePeriodSeconds: sqsConfig.kmsDataKeyReusePeriodSeconds || 300,
            kmsMasterKeyId: kms.arn,
            visibilityTimeoutSeconds: sqsConfig.dlqVisibilityTimeoutSeconds || 30,
            messageRetentionSeconds: sqsConfig.dlqMessageRetentionPeriod || 1209600,
            receiveWaitTimeSeconds: sqsConfig.dlqReceiveWaitTimeSeconds || 0,
            delaySeconds: sqsConfig.dlqDelaySeconds || 0,
            fifoQueue: sqsConfig.fifoQueue || false,
            contentBasedDeduplication: sqsConfig.fifoQueue ? (sqsConfig.contentBasedDeduplication || false) : false,
            deduplicationScope: sqsConfig.fifoQueue && sqsConfig.deduplicationScope ? sqsConfig.deduplicationScope : undefined,
            fifoThroughputLimit: sqsConfig.fifoQueue && sqsConfig.fifoThroughputLimit ? sqsConfig.fifoThroughputLimit : undefined,
            tags: {
                ...this.config.generalTags,
                Name: dlqName,
                Type: "DLQ"
            }
        });

        /**
         * Main Queue
         */
        const queueName = sqsConfig.fifoQueue
            ? `${this.config.generalPrefix}-sqs-${sqsConfig.name}.fifo`
            : `${this.config.generalPrefix}-sqs-${sqsConfig.name}`;

        const queue = new aws.sqs.Queue(`${this.config.project}-sqs-${sqsConfig.name}`, {
            name: queueName,
            kmsDataKeyReusePeriodSeconds: sqsConfig.kmsDataKeyReusePeriodSeconds || 300,
            kmsMasterKeyId: kms.arn,
            visibilityTimeoutSeconds: sqsConfig.visibilityTimeoutSeconds || 30,
            messageRetentionSeconds: sqsConfig.messageRetentionPeriod || 1209600, // 14 days
            receiveWaitTimeSeconds: sqsConfig.receiveWaitTimeSeconds || 0,
            delaySeconds: sqsConfig.delaySeconds || 0,
            redrivePolicy: pulumi.interpolate`{
                "deadLetterTargetArn": "${dlq.arn}",
                "maxReceiveCount": ${sqsConfig.maxReceiveCount || 3}
            }`,
            fifoQueue: sqsConfig.fifoQueue || false,
            contentBasedDeduplication: sqsConfig.fifoQueue ? (sqsConfig.contentBasedDeduplication || false) : false,
            deduplicationScope: sqsConfig.fifoQueue && sqsConfig.deduplicationScope ? sqsConfig.deduplicationScope : undefined,
            fifoThroughputLimit: sqsConfig.fifoQueue && sqsConfig.fifoThroughputLimit ? sqsConfig.fifoThroughputLimit : undefined,
            tags: {
                ...this.config.generalTags,
                Name: queueName,
                Type: "Main"
            }
        });

        /**
         * Queue Policy (optional)
         */
        let queuePolicy: aws.sqs.QueuePolicy | undefined;

        if (sqsConfig.allowedPrincipals || sqsConfig.allowedSourceArns) {
            const policyStatements: any[] = [];

            if (sqsConfig.allowedPrincipals) {
                policyStatements.push({
                    Effect: "Allow",
                    Principal: {
                        AWS: sqsConfig.allowedPrincipals
                    },
                    Action: [
                        "sqs:SendMessage",
                        "sqs:ReceiveMessage",
                        "sqs:DeleteMessage",
                        "sqs:GetQueueAttributes"
                    ],
                    Resource: queue.arn
                });
            }

            if (sqsConfig.allowedSourceArns) {
                policyStatements.push({
                    Effect: "Allow",
                    Principal: "*",
                    Action: "sqs:SendMessage",
                    Resource: queue.arn,
                    Condition: {
                        ArnEquals: {
                            "aws:SourceArn": sqsConfig.allowedSourceArns
                        }
                    }
                });
            }

            queuePolicy = new aws.sqs.QueuePolicy(`${this.config.project}-sqs-${sqsConfig.name}-policy`, {
                queueUrl: queue.url,
                policy: JSON.stringify({
                    Version: "2012-10-17",
                    Statement: policyStatements
                })
            });
        }

        return {
            queue,
            dlq,
            kms,
            queuePolicy,
        } as SqsResult;
    }
}

export {Sqs}