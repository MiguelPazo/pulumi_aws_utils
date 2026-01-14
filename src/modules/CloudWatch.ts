/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {InitConfig} from "../types/module";
import {
    AuditDestination,
    CloudWatchDataProtectionConfig,
    CloudWatchDataProtectionResult,
    DataIdentifierConfig
} from "../types";
import {getInit} from "../config";

class CloudWatch {
    private static __instance: CloudWatch;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): CloudWatch {
        if (this.__instance == null) {
            this.__instance = new CloudWatch();
        }

        return this.__instance;
    }

    async main(config: CloudWatchDataProtectionConfig): Promise<CloudWatchDataProtectionResult> {
        const {
            name,
            auditMode = true,
            deidentifyMode = true,
            dataIdentifiers,
            auditDestination,
            kmsKey
        } = config;

        // Build data identifiers list
        const identifiers = this.buildDataIdentifiers(dataIdentifiers);

        // Create default audit log group if audit mode is enabled and no destination provided
        let auditLogGroup: aws.cloudwatch.LogGroup | undefined;
        let effectiveAuditDestination = auditDestination;

        if (auditMode && !auditDestination?.cloudWatchLogs && !auditDestination?.s3 && !auditDestination?.firehose) {
            auditLogGroup = new aws.cloudwatch.LogGroup(`${this.config.project}-${name}-audit-log`, {
                name: `/aws/cloudwatch-data-protection/${this.config.generalPrefix}/${name}/audit`,
                retentionInDays: this.config.cloudwatchRetentionLogs,
                kmsKeyId: kmsKey ? pulumi.output(kmsKey).apply(k => k.arn) : undefined,
                tags: {
                    ...this.config.generalTags,
                    Name: `/aws/cloudwatch-data-protection/${this.config.generalPrefix}/${name}/audit`
                }
            });

            effectiveAuditDestination = {
                cloudWatchLogs: {
                    logGroup: auditLogGroup.name
                }
            };
        }

        // Build the data protection policy document
        const policyDocument = this.buildPolicyDocument(
            identifiers,
            auditMode,
            deidentifyMode,
            effectiveAuditDestination
        );

        return {
            policyDocument,
            auditLogGroup
        };
    }

    /**
     * Builds the list of data identifiers to detect
     */
    private buildDataIdentifiers(config?: DataIdentifierConfig): string[] {
        const defaultIdentifiers = [
            // Credentials - High Priority
            "arn:aws:dataprotection::aws:data-identifier/AwsSecretKey",
            "arn:aws:dataprotection::aws:data-identifier/OpenSshPrivateKey",
            "arn:aws:dataprotection::aws:data-identifier/PgpPrivateKey",
            "arn:aws:dataprotection::aws:data-identifier/PkcsPrivateKey",
            "arn:aws:dataprotection::aws:data-identifier/PuttyPrivateKey",

            // Personal Information
            "arn:aws:dataprotection::aws:data-identifier/EmailAddress",
            "arn:aws:dataprotection::aws:data-identifier/Address",
            "arn:aws:dataprotection::aws:data-identifier/Name",

            // Financial Information
            "arn:aws:dataprotection::aws:data-identifier/CreditCardNumber",
            "arn:aws:dataprotection::aws:data-identifier/BankAccountNumber-US",

            // Device Identifiers
            "arn:aws:dataprotection::aws:data-identifier/IpAddress"
        ];

        if (!config || !config.categories) {
            return defaultIdentifiers;
        }

        const identifiers: string[] = [];

        // Add custom categories
        config.categories.forEach(category => {
            if (category.startsWith('arn:aws:dataprotection::')) {
                identifiers.push(category);
            } else {
                identifiers.push(`arn:aws:dataprotection::aws:data-identifier/${category}`);
            }
        });

        // Add custom identifiers
        if (config.customIdentifiers) {
            identifiers.push(...config.customIdentifiers);
        }

        return identifiers.length > 0 ? identifiers : defaultIdentifiers;
    }

    /**
     * Builds the data protection policy document
     */
    private buildPolicyDocument(
        identifiers: string[],
        auditMode: boolean,
        deidentifyMode: boolean,
        auditDestination?: AuditDestination
    ): pulumi.Output<string> {
        // Collect all inputs that need to be resolved
        const inputs: any = {};

        if (auditDestination?.cloudWatchLogs) {
            inputs.cwLogGroup = auditDestination.cloudWatchLogs.logGroup;
        }
        if (auditDestination?.firehose) {
            inputs.firehoseStream = auditDestination.firehose.deliveryStream;
        }
        if (auditDestination?.s3) {
            inputs.s3Bucket = auditDestination.s3.bucket;
        }

        return pulumi.output(inputs).apply(resolved => {
            const statements: any[] = [];

            // Add audit mode statement
            if (auditMode) {
                const auditStatement: any = {
                    Sid: "audit-policy",
                    DataIdentifier: identifiers,
                    Operation: {
                        Audit: {
                            FindingsDestination: {}
                        }
                    }
                };

                if (resolved.cwLogGroup) {
                    auditStatement.Operation.Audit.FindingsDestination.CloudWatchLogs = {
                        LogGroup: resolved.cwLogGroup
                    };
                }

                if (resolved.firehoseStream) {
                    auditStatement.Operation.Audit.FindingsDestination.Firehose = {
                        DeliveryStream: resolved.firehoseStream
                    };
                }

                if (resolved.s3Bucket) {
                    auditStatement.Operation.Audit.FindingsDestination.S3 = {
                        Bucket: resolved.s3Bucket
                    };
                }

                statements.push(auditStatement);
            }

            // Add deidentify mode statement
            if (deidentifyMode) {
                statements.push({
                    Sid: "deidentify-policy",
                    DataIdentifier: identifiers,
                    Operation: {
                        Deidentify: {
                            MaskConfig: {}
                        }
                    }
                });
            }

            const policy = {
                Name: "data-protection-policy",
                Description: "Protect sensitive data in CloudWatch Logs",
                Version: "2021-06-01",
                Statement: statements
            };

            return JSON.stringify(policy);
        });
    }
}

export {CloudWatch}
