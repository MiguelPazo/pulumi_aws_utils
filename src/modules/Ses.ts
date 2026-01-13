/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {InitConfig} from "../types/module";
import {SesModuleConfig, SesResult} from "../types";
import {getInit} from "../config";

class Ses {
    private static __instance: Ses;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Ses {
        if (this.__instance == null) {
            this.__instance = new Ses();
        }

        return this.__instance;
    }

    async main(config: SesModuleConfig): Promise<SesResult> {
        const {
            name,
            zone,
            domain,
            configurationSetName,
            dmarcPolicy
        } = config;
        const sesIdentity = new aws.ses.DomainIdentity(`${this.config.project}-${name}-ses-identity`, {
            domain,
        });

        const txtRecord = new aws.route53.Record(`${this.config.project}-${name}-ses-verification-txt-record`, {
            name: sesIdentity.verificationToken.apply(token => `_amazonses.${domain}`),
            records: [sesIdentity.verificationToken],
            ttl: 600,
            type: "TXT",
            zoneId: zone.zoneId
        });

        new aws.ses.DomainIdentityVerification(`${this.config.project}-${name}-ses-verification`, {
            domain: sesIdentity.domain,
        }, {dependsOn: [txtRecord]});

        const dkim = new aws.ses.DomainDkim(`${this.config.project}-${name}-ses-dkim`, {
            domain,
        });

        const dkimRecords = dkim.dkimTokens.apply(tokens =>
            tokens.map((token, i) =>
                new aws.route53.Record(`${domain}-ses-dkim-${i}`, {
                    name: `${token}._domainkey.${domain}`,
                    records: [`${token}.dkim.amazonses.com`],
                    ttl: 600,
                    type: "CNAME",
                    zoneId: zone.zoneId
                })
            )
        );

        /**
         * SPF Configuration
         * Authorizes Amazon SES to send emails on behalf of the domain
         */
        new aws.route53.Record(`${this.config.project}-${name}-ses-spf-record`, {
            name: domain,
            records: ["v=spf1 include:amazonses.com ~all"],
            ttl: 600,
            type: "TXT",
            zoneId: zone.zoneId
        });

        /**
         * DMARC Configuration
         * AWS recommends starting with "v=DMARC1; p=none;" to monitor email traffic
         */
        const policy = dmarcPolicy?.policy || "none";
        const percentage = dmarcPolicy?.percentage || 100;
        const dkimAlignment = dmarcPolicy?.dkimAlignment || "r";
        const spfAlignment = dmarcPolicy?.spfAlignment || "r";

        let dmarcRecord = `v=DMARC1; p=${policy}`;

        // Only add optional parameters if not using default minimal policy
        if (dmarcPolicy) {
            dmarcRecord += `; pct=${percentage}; adkim=${dkimAlignment}; aspf=${spfAlignment}`;

            if (dmarcPolicy.reportEmail) {
                dmarcRecord += `; rua=mailto:${dmarcPolicy.reportEmail}`;
            }
        }

        new aws.route53.Record(`${this.config.project}-${name}-ses-dmarc-record`, {
            name: `_dmarc.${domain}`,
            records: [dmarcRecord],
            ttl: 600,
            type: "TXT",
            zoneId: zone.zoneId
        });

        /**
         * Configuration Set
         */
        let configSet: aws.ses.ConfigurationSet | undefined;

        if (configurationSetName) {
            configSet = new aws.ses.ConfigurationSet(`${this.config.project}-${name}-ses-config-set`, {
                name: configurationSetName,
                deliveryOptions: {
                    tlsPolicy: "Require"
                },
                reputationMetricsEnabled: true,
                sendingEnabled: true,
            });
        }

        return {
            domainIdentity: sesIdentity,
            domainDkim: dkim,
            configurationSet: configSet,
        } as SesResult;
    }
}

export {Ses}
