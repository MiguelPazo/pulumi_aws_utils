/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import {CertificatesResult, CloudFrontBaseResult} from "../types";
import {UtilsInfra} from "../common/UtilsInfra";
import {getInit} from "../config";
import {InitConfig} from "../types/module";

class CloudFrontFrontend {
    private static __instance: CloudFrontFrontend;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): CloudFrontFrontend {
        if (this.__instance == null) {
            this.__instance = new CloudFrontFrontend();
        }

        return this.__instance;
    }

    async main(
        name: string,
        aliasDns: string,
        cfbase: pulumi.Output<CloudFrontBaseResult>,
        s3Logs: pulumi.Output<aws.s3.Bucket>,
        certificate: CertificatesResult,
        waf: pulumi.Output<aws.wafv2.WebAcl>,
        customErrorResponses?: aws.types.input.cloudfront.DistributionCustomErrorResponse[]
    ): Promise<aws.cloudfront.Distribution> {
        // Create CloudFront distribution
        const cdn = new aws.cloudfront.Distribution(`${this.config.project}-${name}-cf`, {
            enabled: true,
            comment: `${this.config.generalPrefix}-${name}-cf`,
            aliases: [aliasDns],
            defaultRootObject: "index.html",
            priceClass: "PriceClass_100",
            webAclId: waf.arn,

            origins: [
                {
                    originId: name,
                    domainName: pulumi.interpolate`${this.config.generalPrefix}-${this.config.accountId}-${name}.s3.${this.config.region}.amazonaws.com`,
                    originAccessControlId: cfbase.oac.id
                }
            ],

            defaultCacheBehavior: {
                targetOriginId: name,
                viewerProtocolPolicy: "redirect-to-https",
                allowedMethods: ["GET", "HEAD", "OPTIONS"],
                cachedMethods: ["GET", "HEAD", "OPTIONS"],
                compress: true,
                responseHeadersPolicyId: cfbase.hpFrontend.id,
                cachePolicyId: cfbase.cpFrontend.id,
                originRequestPolicyId: "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf"
            },

            customErrorResponses: customErrorResponses ?? [
                {errorCode: 404, responseCode: 404, responsePagePath: "/errors/404.html"},
                {errorCode: 503, responseCode: 503, responsePagePath: "/errors/503.html"},
                {errorCode: 500, responseCode: 500, responsePagePath: "/errors/500.html"},
            ],

            restrictions: {
                geoRestriction: {
                    restrictionType: 'none'
                },
            },

            viewerCertificate: {
                acmCertificateArn: certificate.arn,
                sslSupportMethod: "sni-only",
                minimumProtocolVersion: "TLSv1.2_2021",
            },

            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-cf`,
            }
        });

        /**
         * Logging configuration
         */
        const logDeliverySource = new aws.cloudwatch.LogDeliverySource(`${this.config.project}-${name}-cf-log-source`, {
            name: `${this.config.generalPrefix}-${name}-cf-logs`,
            logType: "ACCESS_LOGS",
            resourceArn: cdn.arn,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-cf-logs`,
            }
        }, {
            provider: this.config.providerVirginia,
            dependsOn: [cdn]
        });

        const logDeliveryDestination = new aws.cloudwatch.LogDeliveryDestination(`${this.config.project}-${name}-cf-log-destination`, {
            name: `${this.config.generalPrefix}-${name}-cf-s3-destination`,
            outputFormat: "parquet",
            deliveryDestinationConfiguration: {
                destinationResourceArn: pulumi.interpolate`${s3Logs.arn}/${aliasDns}/`
            },
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-cf-s3-destination`,
            }
        }, {
            provider: this.config.providerVirginia
        });

        new aws.cloudwatch.LogDelivery(`${this.config.project}-${name}-cf-log-delivery`, {
            deliverySourceName: logDeliverySource.name,
            deliveryDestinationArn: logDeliveryDestination.arn,
            s3DeliveryConfigurations: [{
                suffixPath: `/{DistributionId}/{yyyy}/{MM}/{dd}/{HH}`,
                enableHiveCompatiblePath: false
            }],
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-cf-log-delivery`,
            }
        }, {
            provider: this.config.providerVirginia,
            dependsOn: [logDeliverySource, logDeliveryDestination]
        });

        UtilsInfra.createAliasRecord(certificate, cdn.domainName, cdn.hostedZoneId, true);

        return cdn;
    }
}

export {CloudFrontFrontend}
