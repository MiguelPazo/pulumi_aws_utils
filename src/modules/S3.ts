/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {InitConfig} from "../types/module";
import {S3Config} from "../types";
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

    async main(config: S3Config): Promise<aws.s3.Bucket> {
        const {
            name,
            kmsKey,
            s3Logs,
            enableCors,
            enableReceiveLogs = false,
            enableCloudfrontLogs = false,
            cloudfront,
            fullName,
            enableObjectLock = false,
            disableAcl = true,
            disablePolicy = false,
            provider,
        } = config;

        const bucketName = fullName || pulumi.interpolate`${this.config.generalPrefix}-${this.config.accountId}-${name}`;

        const resourceOptions: pulumi.ResourceOptions = provider ? {provider} : {};

        const bucket = new aws.s3.Bucket(`${this.config.project}-${name}-bucket`, {
            bucket: bucketName,
            objectLockEnabled: enableObjectLock,
            tags: {
                ...this.config.generalTags,
                Name: bucketName,
            }
        }, resourceOptions);

        // Configure versioning (required for Object Lock)
        if (enableObjectLock) {
            new aws.s3.BucketVersioning(`${this.config.project}-${name}-bucket-versioning`, {
                bucket: bucket.id,
                versioningConfiguration: {
                    status: "Enabled"
                }
            }, resourceOptions);

            // Configure Object Lock default retention
            new aws.s3.BucketObjectLockConfiguration(`${this.config.project}-${name}-bucket-object-lock`, {
                bucket: bucket.id,
                rule: {
                    defaultRetention: {
                        mode: "GOVERNANCE",
                        days: 90
                    }
                }
            }, resourceOptions);
        }

        new aws.s3.BucketOwnershipControls(`${this.config.project}-${name}-bucket-ownership`, {
            bucket: bucket.id,
            rule: {
                objectOwnership: disableAcl ? "BucketOwnerEnforced" : "ObjectWriter",
            },
        }, resourceOptions);

        // Configure ACL if not disabled
        if (!disableAcl) {
            new aws.s3.BucketAcl(`${this.config.project}-${name}-bucket-acl`, {
                bucket: bucket.id,
                acl: "private"
            }, resourceOptions);
        }

        new aws.s3.BucketServerSideEncryptionConfiguration(`${this.config.project}-${name}-bucket-encrypt`, {
            bucket: bucket.id,
            rules: [{
                applyServerSideEncryptionByDefault: {
                    sseAlgorithm: kmsKey ? "aws:kms" : "AES256",
                    kmsMasterKeyId: kmsKey?.arn,
                },
            }],
        }, resourceOptions);

        // Build bucket policy with all required statements
        if (!disablePolicy) {
            const policyInputs: pulumi.Input<any>[] = [bucket.arn, this.config.accountId];
            let elbServiceAccPromise: Promise<any> | null = null;

            if (enableReceiveLogs) {
                elbServiceAccPromise = aws.elb.getServiceAccount({});
                policyInputs.push(elbServiceAccPromise);
            }

            if (cloudfront) {
                policyInputs.push(cloudfront.id);
            }

            new aws.s3.BucketPolicy(`${this.config.project}-${name}-bucket-policy`, {
                bucket: bucket.id,
                policy: pulumi.all(policyInputs).apply(values => {
                    const bucketArn = values[0] as string;
                    const accountId = values[1] as string;
                    let valueIndex = 2;
                    const elbServiceAcc = enableReceiveLogs ? values[valueIndex++] : null;
                    const cdnId = cloudfront ? values[enableReceiveLogs ? valueIndex : valueIndex - 1] : null;

                    const statements: any[] = [];

                    // Always add secure transport policy
                    statements.push({
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
                    });

                    // Add receive logs policies if enabled
                    if (enableReceiveLogs && elbServiceAcc) {
                        statements.push({
                            "Effect": "Allow",
                            "Principal": {
                                "AWS": elbServiceAcc.arn
                            },
                            "Action": "s3:PutObject",
                            "Resource": `${bucketArn}/*`
                        });

                        statements.push({
                            "Effect": "Allow",
                            "Principal": {
                                "Service": "delivery.logs.amazonaws.com"
                            },
                            "Action": "s3:PutObject",
                            "Resource": `${bucketArn}/*`,
                            "Condition": {
                                "StringEquals": {
                                    "s3:x-amz-acl": "bucket-owner-full-control"
                                }
                            }
                        });

                        statements.push({
                            "Effect": "Allow",
                            "Principal": {
                                "Service": "delivery.logs.amazonaws.com"
                            },
                            "Action": "s3:GetBucketAcl",
                            "Resource": bucketArn
                        });
                    }

                    // Add CloudFront logs policy if enabled
                    if (enableCloudfrontLogs) {
                        statements.push({
                            "Effect": "Allow",
                            "Principal": {
                                "Service": "cloudfront.amazonaws.com"
                            },
                            "Action": "s3:PutObject",
                            "Resource": `${bucketArn}/*`,
                            "Condition": {
                                "StringEquals": {
                                    "AWS:SourceArn": `arn:aws:cloudfront::${accountId}:distribution/*`
                                }
                            }
                        });
                    }

                    // Add CloudFront GetObject policy if cloudfront distribution is defined
                    if (cloudfront && cdnId) {
                        statements.push({
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
                        });
                    }

                    return JSON.stringify({
                        "Version": "2012-10-17",
                        "Statement": statements
                    });
                })
            }, resourceOptions);
        }

        if (enableCors) {
            new aws.s3.BucketCorsConfiguration(`${this.config.project}-${name}-bucket-cors`, {
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
            }, resourceOptions);
        }

        if (s3Logs) {
            new aws.s3.BucketLogging(`${this.config.project}-${name}-bucket-logging`, {
                bucket: bucket.id,
                targetBucket: s3Logs.id,
                targetPrefix: pulumi.interpolate`${bucket.id}/`
            }, resourceOptions);
        }

        if (enableObjectLock) {
            new aws.s3.BucketLifecycleConfiguration(`${this.config.project}-${name}-bucket-lifecycle`, {
                bucket: bucket.id,
                rules: [
                    {
                        id: "expire-noncurrent-versions",
                        status: "Enabled",
                        noncurrentVersionExpiration: {
                            noncurrentDays: 90
                        }
                    },
                    {
                        id: "delete-expired-object-delete-markers",
                        status: "Enabled",
                        expiration: {
                            expiredObjectDeleteMarker: true
                        }
                    }
                ]
            }, resourceOptions);
        }

        return bucket
    }
}

export {S3}
