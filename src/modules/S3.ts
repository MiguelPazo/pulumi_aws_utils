/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {InitConfig} from "../types/module";
import {getInit} from "../config";

class S3 {
    private static __instance: S3;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): S3 {
        if (this.__instance == null) {
            this.__instance = new S3();
        }

        return this.__instance;
    }

    async main(
        name: string,
        kmsKey?: pulumi.Output<aws.kms.Key>,
        enableCors?: boolean,
        cdn?: pulumi.Output<aws.cloudfront.Distribution>,
        enableReceiveLogs?: boolean,
    ): Promise<aws.s3.Bucket> {
        const bucketName = pulumi.interpolate`${this.config.generalPrefix}-${this.config.accountId}-${name}`;

        const bucket = new aws.s3.Bucket(`${this.config.project}-${name}-bucket`, {
            bucket: bucketName,
            acl: "private",
            tags: {
                ...this.config.generalTags,
                Name: bucketName,
            }
        });

        new aws.s3.BucketOwnershipControls(`${this.config.project}-${name}-bucket-ownership`, {
            bucket: bucket.id,
            rule: {
                objectOwnership: "ObjectWriter",
            },
        });

        new aws.s3.BucketServerSideEncryptionConfigurationV2(`${this.config.project}-${name}-bucket-encrypt`, {
            bucket: bucket.id,
            rules: [{
                applyServerSideEncryptionByDefault: {
                    sseAlgorithm: kmsKey ? "aws:kms" : "AES256",
                    kmsMasterKeyId: kmsKey?.arn,
                },
            }],
        });

        if (cdn) {
            new aws.s3.BucketPolicy(`${this.config.project}-${name}-bucket-policy`, {
                bucket: bucket.id,
                policy: pulumi.all([bucket.arn, this.config.accountId, cdn.id]).apply(([bucketArn, accountId, cdnId]) => {
                    return JSON.stringify({
                        "Version": "2012-10-17",
                        "Statement": [
                            {
                                "Effect": "Deny",
                                "Principal": "*",
                                "Action": "s3:*",
                                "Resource": [
                                    bucketArn,
                                    `${bucketArn}/*`
                                ],
                                "Condition": {
                                    "Bool": {
                                        "aws:SecureTransport": "false"
                                    }
                                }
                            },
                            {
                                "Effect": "Allow",
                                "Principal": {
                                    "Service": "cloudfront.amazonaws.com"
                                },
                                "Action": "s3:GetObject",
                                "Resource": `${bucketArn}/*`,
                                "Condition": {
                                    "StringEquals": {
                                        "AWS:SourceArn": `arn:aws:cloudfront::${accountId}:distribution/${cdnId}`
                                    }
                                }
                            }
                        ]
                    })
                })
            });
        } else if (enableReceiveLogs) {
            const elbServiceAcc = aws.elb.getServiceAccount({});

            new aws.s3.BucketPolicy(`${this.config.project}-${name}-bucket-policy`, {
                bucket: bucket.id,
                policy: pulumi.all([bucket.arn, elbServiceAcc]).apply(([bucketArn, elbServiceAcc]) => {
                    return JSON.stringify({
                        "Version": "2012-10-17",
                        "Statement": [
                            {
                                "Effect": "Deny",
                                "Principal": "*",
                                "Action": "s3:*",
                                "Resource": [
                                    bucketArn,
                                    `${bucketArn}/*`
                                ],
                                "Condition": {
                                    "Bool": {
                                        "aws:SecureTransport": "false"
                                    }
                                }
                            },
                            {
                                "Effect": "Allow",
                                "Principal": {
                                    "AWS": elbServiceAcc.arn
                                },
                                "Action": "S3:PutObject",
                                "Resource": `${bucketArn}/*`
                            },
                            {
                                "Effect": "Allow",
                                "Principal": {
                                    "Service": "delivery.logs.amazonaws.com"
                                },
                                "Action": "S3:PutObject",
                                "Resource": `${bucketArn}/*`,
                                "Condition": {
                                    "StringEquals": {
                                        "s3:x-amz-acl": "bucket-owner-full-control"
                                    }
                                }
                            },
                            {
                                "Effect": "Allow",
                                "Principal": {
                                    "Service": "delivery.logs.amazonaws.com"
                                },
                                "Action": "S3:GetBucketAcl",
                                "Resource": bucketArn
                            },
                        ]
                    })
                })
            });
        } else {
            new aws.s3.BucketPolicy(`${this.config.project}-${name}-bucket-policy`, {
                bucket: bucket.id,
                policy: pulumi.output(bucket.arn).apply(bucketArn => {
                    return JSON.stringify({
                        "Version": "2012-10-17",
                        "Statement": [
                            {
                                "Effect": "Deny",
                                "Principal": "*",
                                "Action": "s3:*",
                                "Resource": [
                                    bucketArn,
                                    `${bucketArn}/*`
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
        }

        if (enableCors) {
            new aws.s3.BucketCorsConfigurationV2(`${this.config.project}-${name}-bucket-cors`, {
                bucket: bucket.id,
                corsRules: [
                    {
                        allowedHeaders: ["*"],
                        allowedMethods: [
                            "GET",
                        ],
                        allowedOrigins: ["*"],
                        maxAgeSeconds: 0
                    }
                ],
            });
        }

        return bucket
    }
}

export {S3}
