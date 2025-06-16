"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudFrontFrontend = void 0;
/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
const aws = require("@pulumi/aws");
const pulumi = require("@pulumi/pulumi");
const UtilsInfra_1 = require("../common/UtilsInfra");
const config_1 = require("../config");
class CloudFrontFrontend {
    constructor() {
        this.config = (0, config_1.getInit)();
    }
    static getInstance() {
        if (this.__instance == null) {
            this.__instance = new CloudFrontFrontend();
        }
        return this.__instance;
    }
    async main(name, aliasDns, cfbase, s3Logs, certificate, waf) {
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
                    domainName: pulumi.interpolate `${this.config.generalPrefix}-${this.config.accountId}-${name}.s3.${this.config.region}.amazonaws.com`,
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
                originRequestPolicyId: this.config.cfOriginPolicyCorsS3
            },
            customErrorResponses: [
                { errorCode: 404, responseCode: 404, responsePagePath: "/errors/404.html" },
                { errorCode: 503, responseCode: 503, responsePagePath: "/errors/503.html" },
                { errorCode: 500, responseCode: 500, responsePagePath: "/errors/500.html" },
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
            loggingConfig: {
                bucket: s3Logs.bucketDomainName,
                includeCookies: false,
                prefix: `${aliasDns}/`,
            },
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-${name}-cf`,
            }
        });
        UtilsInfra_1.UtilsInfra.createAliasRecord(certificate, cdn.domainName, cdn.hostedZoneId, true);
        return cdn;
    }
}
exports.CloudFrontFrontend = CloudFrontFrontend;
//# sourceMappingURL=CloudFrontFrontend.js.map