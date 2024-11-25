import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Subscription, SubscriptionProtocol, Topic } from "aws-cdk-lib/aws-sns";
import { AttributeType, BillingMode, StreamViewType, Table } from "aws-cdk-lib/aws-dynamodb";
import { CfnOutput } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { FilterCriteria, Runtime, StartingPosition } from "aws-cdk-lib/aws-lambda";
import { LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

export class CdkStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // DynamoDB Table (added earlier)
        const errorTable = new Table(this, "ErrorTable", {
            partitionKey: {
                name: "id",
                type: AttributeType.STRING,
            },
            billingMode: BillingMode.PAY_PER_REQUEST,
            timeToLiveAttribute: "ttl",
            stream: StreamViewType.NEW_AND_OLD_IMAGES,
        });

        // SNS Topic
        const errorTopic = new Topic(this, "ErrorTopic", {
            topicName: "ErrorTopic",
        });

        // Lambda Function for JSON Processing
        const processFunction = new NodejsFunction(this, "processFunction", {
            runtime: Runtime.NODEJS_20_X,
            handler: "handler",
            entry: `${__dirname}/../src/processFunction.ts`,
            environment: {
                TABLE_NAME: errorTable.tableName,
                TOPIC_ARN: errorTopic.topicArn,
            },
        });

        // Cleanup Lambda
        const cleanupFunction = new NodejsFunction(this, "cleanupFunction", {
            runtime: Runtime.NODEJS_20_X,
            handler: "handler",
            entry: `${__dirname}/../src/cleanupFunction.ts`,
            environment: {
                TABLE_NAME: errorTable.tableName,
                TOPIC_ARN: errorTopic.topicArn,
            },
        });

        // Grant permissions
        errorTable.grantReadWriteData(processFunction);
        errorTopic.grantPublish(processFunction);
        errorTable.grantReadWriteData(cleanupFunction);
        errorTopic.grantPublish(cleanupFunction);

        // Add DynamoDB Event Source
        cleanupFunction.addEventSource(
            new DynamoEventSource(errorTable, {
                startingPosition: StartingPosition.LATEST,
                batchSize: 5,
                filters: [
                    FilterCriteria.filter({
                        eventName: { eq: ["REMOVE"] },
                    }),
                ],
            })
        );

        // API Gateway
        const api = new RestApi(this, "ProcessorApi");
        const resource = api.root.addResource("processJSON");
        resource.addMethod("POST", new LambdaIntegration(processFunction));

        // Email Subscription
        new Subscription(this, "ErrorSubscription", {
            topic: errorTopic,
            protocol: SubscriptionProtocol.EMAIL,
            endpoint: "atclient115@gmail.com",
        });

        // Outputs
        new CfnOutput(this, "TopicArn", {
            value: errorTopic.topicArn,
        });

        // REST API output endpoint
        new CfnOutput(this, "RESTApiEndpoint", {
            value: `https://${api.restApiId}.execute-api.eu-center-1.amazonaws.com/prod/processJSON`,
        });
    }
}
