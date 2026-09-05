import { FastMCP } from "fastmcp";
import { z } from "zod";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import dotenv from "dotenv";
import { buyOrder, sellOrder } from "./contractCalls";
import Alpaca from "@alpacahq/alpaca-trade-api";
import { readUserHoldings } from "./readContract";
import { wallet } from "./contract";


dotenv.config();

const server = new FastMCP({
  name: "MCP",
  version: "1.0.0",
});


server.addTool({
  name: "buyStock",
  description: "buy any stock for any quantity, be it market or limit. ",
  parameters: z.object({
    stockSymbol: z.string().describe("the symbol of stock on exchange."),
    stockQuantity: z.string().describe("the quantity of stock u want to buy"),
    amount: z.string().describe("the amount of usdc u want to lock in the contract"),
    orderType: z.string().describe("limit or market")
  }),
  execute: async (args) => {

    const {orderId,tx} = await buyOrder(args.stockSymbol,args.stockQuantity,args.amount,args.orderType);

    return `
        txHash: ${tx},
        orderId: ${orderId}
    `;
  },
});

server.addTool({
    name: "sellStock",
    description: "sell your stock, be it market or limit. ",
    parameters: z.object({
      stockSymbol: z.string().describe("the symbol of stock on exchange."),
      stockQuantity: z.string().describe("the quantity of stock u want to sell"),
      amount: z.string().describe("the amount of DSTOCK token u want to burn, equal to stockQuantity"),
      orderType: z.string().describe("limit or market")
    }),
    execute: async (args) => {
  
      const {orderId,tx} = await sellOrder(args.stockSymbol,args.stockQuantity,args.amount,args.orderType);
  
      return `
          txHash: ${tx},
          orderId: ${orderId}
      `;
    },
  });

  server.addTool({
    name: "checkOrder",
    description: "check order on Alpaca using client order id",
    parameters: z.object({
      orderId: z.string().describe("OrderId used while creating the Alpaca order")
    }),
    execute: async (args) => {
  
      const alpaca = new Alpaca({
        keyId: "REDACTED_ALPACA_KEY_ID",
        secretKey: "REDACTED_ALPACA_SECRET",
        paper: true
      });
  
      try {
        const order = await alpaca.getOrderByClientId(args.orderId);
        return JSON.stringify({
          status: order.status,
          filled_qty: order.filled_qty,
          submitted_at: order.submitted_at,
          updated_at: order.updated_at,
          symbol: order.symbol,
          side: order.side,
          type: order.type
        }, null, 2);
  
      } catch (err) {
        return `❌ Order lookup failed: ${err.message}`;
      }
    },
  });
  

  server.addTool({
    name: "checkHoldings",
    description: "check holdings of stocks",
    execute: async () => {
  
        const result = await readUserHoldings(wallet.address);
  
      return `
          result: ${result}
      `;
    },
  });



// Start the FastMCP server
server.start({
  transportType: "httpStream",
  httpStream: {
    port: 8081,
  },
});

// Create Express server
const app = express();

// Proxy /mcp to FastMCP server
app.use(
  "/mcp",
  createProxyMiddleware({
    target: "http://localhost:8081/mcp",
    changeOrigin: true,
    ws: true,
    ignorePath: true,
  })
);

// Start Express server
app.listen(3000, () => {
  console.log("Express proxy running on http://localhost:3000");
  console.log("FastMCP endpoint: http://localhost:3000/mcp");
});