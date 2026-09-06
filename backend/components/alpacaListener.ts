import { handleTradeSettlement } from "./contractCalls";
import { orderDB } from "./orderStore";
import { ethers } from "ethers";
import { alpaca } from "./alpacaClient";
import { contract } from "./contract";

export async function listenToOrderEvents() {
    const ws = alpaca.trade_ws;

    ws.onConnect(() => {
      console.log("Connected to Alpaca order streams.");
      ws.subscribe(["trade_updates"]);
    });

    ws.onStateChange((state) => {
      console.log("Websocket state changed:", state);
    });

    ws.onOrderUpdate(async (event) => {

        console.log("event", event);

        const {event:status, order} = event;

        const orderId = order.client_order_id;
        console.log("got order", orderId)

        if (!orderDB.includes(orderId)){
            console.log('order is not there')
            return;
        };

        if (status === "fill") {
            console.log(`Order Filled! Executing settlement logic`);

            const isBuy = order.side === "buy";
            let amountToRefund = 0;

            if (isBuy) {
                // Read this order's escrowed USDC from the chain so refunds
                // can never exceed what was actually locked for it.
                const req = await contract.requests(orderId);
                // requests returns (requester, usdcBalance, tokenBalance, isRedeem)
                const escrowedUsdc = Number(ethers.formatUnits(req[1], 6));
                const notional = Number(order.filled_qty) * Number(order.filled_avg_price);
                amountToRefund = Math.max(0, escrowedUsdc - notional);
            }
            // For sells, the user receives the full proceeds; refund stays 0
            // and the payout below carries the value.
            else {
                amountToRefund = Number(order.filled_qty) * Number(order.filled_avg_price);
            }

            console.log("amount to refund:", amountToRefund);
            const scaledValue = ethers.parseUnits(amountToRefund.toString(), 6);

            // Your settlement or blockchain interaction here:
            const tx = await handleTradeSettlement(orderId, order.symbol, order.filled_qty, order.side, scaledValue);

            console.log("fulfilled request",tx);
          }
          else {
            console.log("order is pending for order with orderId:",orderId)
          }
    });

    ws.connect();
  }
