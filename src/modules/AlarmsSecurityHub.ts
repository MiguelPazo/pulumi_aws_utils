/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {AlarmsSecurityHubConfig, AlarmsSecurityHubResult} from "../types";
import {InitConfig} from "../types/module";
import {getInit} from "../config";

class AlarmsSecurityHub {
    private static __instance: AlarmsSecurityHub;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): AlarmsSecurityHub {
        if (this.__instance == null) {
            this.__instance = new AlarmsSecurityHub();
        }

        return this.__instance;
    }

    async main(shConfig: AlarmsSecurityHubConfig): Promise<AlarmsSecurityHubResult> {
        const metricFilters: aws.cloudwatch.LogMetricFilter[] = [];
        const alarms: aws.cloudwatch.MetricAlarm[] = [];
        const namespace = `${this.config.generalPrefix}/securityhub`;

        // Prioritize lambdaAlarmsArn over snsTopicArn
        const actionArn = shConfig.lambdaAlarmsArn || shConfig.snsTopicArn;

        if (!actionArn) {
            throw new Error("Either lambdaAlarmsArn or snsTopicArn must be provided");
        }

        const metrics: { enabled: boolean; shortName: string; metricName: string; pattern: string; description: string }[] = [
            {
                enabled: shConfig.monitorS3DisableBlockPublicAccess !== false,
                shortName: "sh-s3-disable-block-public-access",
                metricName: "S3DisableBlockPublicAccess",
                pattern: '{ $.detail.findings[0].Compliance.Status = "FAILED" && $.detail.findings[0].Compliance.SecurityControlId = "S3.1" }',
                description: "SecurityHub S3.1 - S3 general purpose bucket has Block Public Access settings disabled"
            },
            {
                enabled: shConfig.monitorS3PublicRead !== false,
                shortName: "sh-s3-public-read",
                metricName: "S3PublicRead",
                pattern: '{ $.detail.findings[0].Compliance.Status = "FAILED" && $.detail.findings[0].Compliance.SecurityControlId = "S3.2" }',
                description: "SecurityHub S3.2 - S3 general purpose bucket has public read access"
            },
            {
                enabled: shConfig.monitorS3PublicWrite !== false,
                shortName: "sh-s3-public-write",
                metricName: "S3PublicWrite",
                pattern: '{ $.detail.findings[0].Compliance.Status = "FAILED" && $.detail.findings[0].Compliance.SecurityControlId = "S3.3" }',
                description: "SecurityHub S3.3 - S3 general purpose bucket has public write access"
            },
            {
                enabled: shConfig.monitorS3ServerSideEncryption !== false,
                shortName: "sh-s3-server-side-encryption",
                metricName: "S3ServerSideEncryption",
                pattern: '{ $.detail.findings[0].Compliance.Status = "FAILED" && $.detail.findings[0].Compliance.SecurityControlId = "S3.6" }',
                description: "SecurityHub S3.6 - S3 general purpose bucket policy should restrict access to other AWS accounts"
            },
            {
                enabled: shConfig.monitorS3BlockPublicAccess !== false,
                shortName: "sh-s3-block-public-access",
                metricName: "S3BlockPublicAccess",
                pattern: '{ $.detail.findings[0].Compliance.Status = "FAILED" && $.detail.findings[0].Compliance.SecurityControlId = "S3.8" }',
                description: "SecurityHub S3.8 - S3 Block Public Access setting is not enabled at bucket level"
            }
        ];

        for (const metric of metrics) {
            if (metric.enabled) {
                const {metricFilter, alarm} = this.createMetric(
                    shConfig.logGroupName,
                    actionArn,
                    namespace,
                    metric.shortName,
                    metric.metricName,
                    metric.pattern,
                    metric.description
                );
                metricFilters.push(metricFilter);
                alarms.push(alarm);
            }
        }

        return {
            metricFilters,
            alarms
        };
    }

    private createMetric(
        logGroupName: pulumi.Input<string>,
        actionArn: pulumi.Input<string>,
        namespace: string,
        shortName: string,
        metricName: string,
        pattern: string,
        description: string
    ): { metricFilter: aws.cloudwatch.LogMetricFilter; alarm: aws.cloudwatch.MetricAlarm } {
        const metricFilter = new aws.cloudwatch.LogMetricFilter(
            `${this.config.project}-${shortName}-filter`,
            {
                name: `${this.config.generalPrefix}-${shortName}`,
                logGroupName: logGroupName,
                pattern: pattern,
                metricTransformation: {
                    name: metricName,
                    namespace: namespace,
                    value: "1",
                    defaultValue: "0"
                }
            }
        );

        const alarm = new aws.cloudwatch.MetricAlarm(
            `${this.config.project}-${shortName}-alarm`,
            {
                name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/${shortName}`),
                comparisonOperator: "GreaterThanOrEqualToThreshold",
                evaluationPeriods: 1,
                metricName: metricName,
                namespace: namespace,
                period: 300,
                statistic: "Sum",
                threshold: 1,
                alarmDescription: description,
                alarmActions: [actionArn],
                treatMissingData: "notBreaching",
                tags: {
                    ...this.config.generalTags,
                    service_name: "alarm-admin",
                    Name: pulumi.output(this.config.accountId).apply(accountId => `AWS-ALARM/${accountId}/Admin/${this.config.project}/${this.config.stackAlias || this.config.stack}/${shortName}`)
                }
            },
            {dependsOn: [metricFilter]}
        );

        return {metricFilter, alarm};
    }
}

export {AlarmsSecurityHub}
