/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {AlarmsInspectorConfig, AlarmsInspectorResult} from "../types";
import {InitConfig} from "../types/module";
import {getInit} from "../config";

class AlarmsInspector {
    private static __instance: AlarmsInspector;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): AlarmsInspector {
        if (this.__instance == null) {
            this.__instance = new AlarmsInspector();
        }

        return this.__instance;
    }

    async main(inspectorConfig: AlarmsInspectorConfig): Promise<AlarmsInspectorResult> {
        const metricFilters: aws.cloudwatch.LogMetricFilter[] = [];
        const alarms: aws.cloudwatch.MetricAlarm[] = [];
        const namespace = `${this.config.generalPrefix}/inspector`;

        // Prioritize lambdaAlarmsArn over snsTopicArn
        const actionArn = inspectorConfig.lambdaAlarmsArn || inspectorConfig.snsTopicArn;

        if (!actionArn) {
            throw new Error("Either lambdaAlarmsArn or snsTopicArn must be provided");
        }

        const metrics: { enabled: boolean; shortName: string; metricName: string; pattern: string; description: string }[] = [
            {
                enabled: inspectorConfig.monitorEcrCriticalVulnerability !== false,
                shortName: "insp-ecr-critical",
                metricName: "EcrCriticalVulnerability",
                pattern: '{ $.detail.severity = "CRITICAL" && $.detail.type = "PACKAGE_VULNERABILITY" && $.detail.resources[0].type = "AWS_ECR_CONTAINER_IMAGE" }',
                description: "Inspector: Critical vulnerability found in ECR container image"
            },
            {
                enabled: inspectorConfig.monitorEcrHighVulnerability !== false,
                shortName: "insp-ecr-high",
                metricName: "EcrHighVulnerability",
                pattern: '{ $.detail.severity = "HIGH" && $.detail.type = "PACKAGE_VULNERABILITY" && $.detail.resources[0].type = "AWS_ECR_CONTAINER_IMAGE" }',
                description: "Inspector: High vulnerability found in ECR container image"
            },
            {
                enabled: inspectorConfig.monitorEc2CriticalVulnerability !== false,
                shortName: "insp-ec2-critical",
                metricName: "Ec2CriticalVulnerability",
                pattern: '{ $.detail.severity = "CRITICAL" && $.detail.type = "PACKAGE_VULNERABILITY" && $.detail.resources[0].type = "AWS_EC2_INSTANCE" }',
                description: "Inspector: Critical vulnerability found in EC2 instance"
            },
            {
                enabled: inspectorConfig.monitorEc2HighVulnerability !== false,
                shortName: "insp-ec2-high",
                metricName: "Ec2HighVulnerability",
                pattern: '{ $.detail.severity = "HIGH" && $.detail.type = "PACKAGE_VULNERABILITY" && $.detail.resources[0].type = "AWS_EC2_INSTANCE" }',
                description: "Inspector: High vulnerability found in EC2 instance"
            },
            {
                enabled: inspectorConfig.monitorEc2NetworkReachability !== false,
                shortName: "insp-ec2-network-reach",
                metricName: "Ec2NetworkReachability",
                pattern: '{ $.detail.type = "NETWORK_REACHABILITY" && $.detail.resources[0].type = "AWS_EC2_INSTANCE" }',
                description: "Inspector: Network reachability issue found in EC2 instance"
            }
        ];

        for (const metric of metrics) {
            if (metric.enabled) {
                const {metricFilter, alarm} = this.createMetric(
                    inspectorConfig.logGroupName,
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

export {AlarmsInspector}
