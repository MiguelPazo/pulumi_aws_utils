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
        kmsKey?: pulumi.Output<aws.kms.Key | aws.kms.ReplicaKey>
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

        const dlqArgs: aws.sqs.QueueArgs = {
            name: dlqName,
            kmsDataKeyReusePeriodSeconds: sqsConfig.kmsDataKeyReusePeriodSeconds || 300,
            kmsMasterKeyId: kms.arn,
            visibilityTimeoutSeconds: sqsConfig.dlqVisibilityTimeoutSeconds || 30,
            messageRetentionSeconds: sqsConfig.dlqMessageRetentionPeriod || 1209600,
            receiveWaitTimeSeconds: sqsConfig.dlqReceiveWaitTimeSeconds || 0,
            delaySeconds: sqsConfig.dlqDelaySeconds || 0,
            tags: {
                ...this.config.generalTags,
                Name: dlqName,
                Type: "DLQ"
            }
        };

        // Only add FIFO-specific properties if this is a FIFO queue
        if (sqsConfig.fifoQueue) {
            dlqArgs.fifoQueue = true;
            dlqArgs.contentBasedDeduplication = sqsConfig.contentBasedDeduplication !== undefined
                ? sqsConfig.contentBasedDeduplication
                : false;

            if (sqsConfig.deduplicationScope !== undefined) {
                dlqArgs.deduplicationScope = sqsConfig.deduplicationScope;
            }
            if (sqsConfig.fifoThroughputLimit !== undefined) {
                dlqArgs.fifoThroughputLimit = sqsConfig.fifoThroughputLimit;
            }
        }

        const dlq = new aws.sqs.Queue(`${this.config.project}-sqs-${sqsConfig.name}-dlq`, dlqArgs);

        /**
         * Main Queue
         */
        const queueName = sqsConfig.fifoQueue
            ? `${this.config.generalPrefix}-sqs-${sqsConfig.name}.fifo`
            : `${this.config.generalPrefix}-sqs-${sqsConfig.name}`;

        const queueArgs: aws.sqs.QueueArgs = {
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
            tags: {
                ...this.config.generalTags,
                Name: queueName,
                Type: "Main"
            }
        };

        // Only add FIFO-specific properties if this is a FIFO queue
        if (sqsConfig.fifoQueue) {
            queueArgs.fifoQueue = true;
            queueArgs.contentBasedDeduplication = sqsConfig.contentBasedDeduplication !== undefined
                ? sqsConfig.contentBasedDeduplication
                : false;

            if (sqsConfig.deduplicationScope !== undefined) {
                queueArgs.deduplicationScope = sqsConfig.deduplicationScope;
            }
            if (sqsConfig.fifoThroughputLimit !== undefined) {
                queueArgs.fifoThroughputLimit = sqsConfig.fifoThroughputLimit;
            }
        }

        const queue = new aws.sqs.Queue(`${this.config.project}-sqs-${sqsConfig.name}`, queueArgs);

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