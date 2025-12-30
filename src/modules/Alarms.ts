/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {AlarmConfig, AlarmsModuleConfig, AlarmsResult, ServiceAlarmConfig} from "../types";
import {InitConfig} from "../types/module";
import {getInit} from "../config";
import {LambdaAlarms} from "../tools/LambdaAlarms";
import {LambdaNotifications} from "../tools/LambdaNotifications";

class Alarms {
    private static __instance: Alarms;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Alarms {
        if (this.__instance == null) {
            this.__instance = new Alarms();
        }

        return this.__instance;
    }

    async main(alarmsConfig: AlarmsModuleConfig): Promise<AlarmsResult> {
        const result: AlarmsResult = {
            alarms: {}
        };

        // Get current account ID and region
        const accountId = await this.config.accountId;
        const region = this.config.region;

        // Deploy Lambda Alarms if requested
        if (alarmsConfig.deployLambdaAlarms) {
            const lambdaResources = await LambdaAlarms.getInstance().main(
                accountId,
                alarmsConfig.snsArn,
                alarmsConfig.snsKmsKey,
                alarmsConfig.cwLogsKmsKey,
            );
            result.lambdaFunction = lambdaResources.lambdaFunction;
            result.lambdaRole = lambdaResources.lambdaRole;
            result.lambdaLogGroup = lambdaResources.logGroup;
        }

        // Deploy Lambda Notifications (Slack) if requested
        if (alarmsConfig.deployLambdaNotifications) {
            if (!alarmsConfig.slackWebhookUrl) {
                throw new Error("slackWebhookUrl is required when deployLambdaNotifications is true");
            }

            const lambdaNotificationsResources = await LambdaNotifications.getInstance().main(
                accountId,
                alarmsConfig.snsArn,
                alarmsConfig.slackWebhookUrl,
                alarmsConfig.cwLogsKmsKey,
            );
            result.lambdaNotificationsFunction = lambdaNotificationsResources.lambdaFunction;
            result.lambdaNotificationsRole = lambdaNotificationsResources.lambdaRole;
            result.lambdaNotificationsLogGroup = lambdaNotificationsResources.logGroup;
            result.lambdaNotificationsSnsSubscription = lambdaNotificationsResources.snsSubscription;
        }

        // Determine alarm actions
        const lambdaArn = alarmsConfig.deployLambdaAlarms
            ? result.lambdaFunction!.arn
            : alarmsConfig.lambdaAlarmsArn;

        const alarmActions = alarmsConfig.alarmActionsArns ||
            (lambdaArn ? [lambdaArn] : [alarmsConfig.snsArn]);

        const okActions = alarmsConfig.okActionsArns || alarmActions;

        // Flatten the alarm list structure to create individual alarms
        for (const service of alarmsConfig.alarmsList) {
            for (const alarm of service.alarms) {
                const alarmKey = `${service.service_name}-${alarm.alarm_name}`;

                // Build the alarm resource
                result.alarms[alarmKey] = this.createAlarm(
                    alarmKey,
                    service,
                    alarm,
                    accountId,
                    alarmActions,
                    okActions,
                    result.lambdaFunction
                );
            }
        }

        return result;
    }

    /**
     * Creates a single CloudWatch metric alarm
     */
    private createAlarm(
        alarmKey: string,
        service: ServiceAlarmConfig,
        alarm: AlarmConfig,
        accountId: string,
        alarmActions: pulumi.Input<string>[],
        okActions: pulumi.Input<string>[],
        lambdaFunction?: aws.lambda.Function
    ): aws.cloudwatch.MetricAlarm {
        // Determine the metric name for the alarm name
        const metricNameForAlarmName = alarm.metric_name ||
            (alarm.metric_query && alarm.metric_query.length > 0 && alarm.metric_query[0].metric
                ? alarm.metric_query[0].metric.metric_name
                : "custom");

        // Build alarm name following Terraform pattern
        const alarmName = `AWS-ALARM/${accountId}/${service.service_aws}/${metricNameForAlarmName}/${service.service_name}/${alarm.alarm_name}${alarm.alarm_name_suffix || ""}`;

        // Build metric queries if present
        const metricQueries = alarm.metric_query ? alarm.metric_query.map(mq => {
            const query: aws.types.input.cloudwatch.MetricAlarmMetricQuery = {
                id: mq.id,
                expression: mq.expression,
                label: mq.label,
                returnData: mq.return_data
            };

            if (mq.metric) {
                query.metric = {
                    namespace: mq.metric.namespace,
                    metricName: mq.metric.metric_name,
                    period: parseInt(mq.metric.period),
                    stat: mq.metric.stat,
                    unit: mq.metric.unit,
                    dimensions: mq.metric.dimensions
                };
            }

            return query;
        }) : undefined;

        // Merge tags
        const alarmTags = {
            ...this.config.generalTags,
            Name: `AWS-ALARM/${accountId}/${service.service_aws}/${metricNameForAlarmName}/${service.service_name}`,
            "service_name": service.service_name,
            ...(service.tags || {}),
            ...(alarm.tags || {})
        };

        // Convert tag values to strings for CloudWatch
        const stringTags: { [key: string]: string } = {};
        for (const [key, value] of Object.entries(alarmTags)) {
            stringTags[key] = typeof value === 'string' ? value : String(value);
        }

        // Create the alarm with optional dependency on Lambda
        const alarmOptions: pulumi.ResourceOptions = {};

        if (lambdaFunction) {
            alarmOptions.dependsOn = [lambdaFunction];
        }

        return new aws.cloudwatch.MetricAlarm(
            `${alarmKey}-alarm`,
            {
                name: alarmName,
                comparisonOperator: alarm.comparison_operator,
                evaluationPeriods: parseInt(alarm.evaluation_periods),
                threshold: parseFloat(alarm.threshold),
                datapointsToAlarm: parseInt(alarm.datapoints_to_alarm),
                alarmDescription: alarm.alarm_description,
                actionsEnabled: true,
                alarmActions: alarmActions,
                okActions: okActions,
                treatMissingData: alarm.treat_missing_data || "missing",

                // Standard metric alarm properties (only used if metric_query is not present)
                metricName: alarm.metric_name,
                namespace: alarm.namespace,
                period: alarm.period ? parseInt(alarm.period) : undefined,
                statistic: alarm.statistic,
                dimensions: alarm.dimensions,

                // Metric query properties (only used if present)
                metricQueries: metricQueries,

                tags: stringTags
            },
            alarmOptions
        );
    }
}

export {Alarms}
