import Alpaca from "@alpacahq/alpaca-trade-api";
import { v4 as uuidv4 } from "uuid";
import { orderDB } from "./orderStore";

const alpaca = new Alpaca({
  keyId: "REDACTED_ALPACA_KEY_ID",
  secretKey: "REDACTED_ALPACA_SECRET",
  paper: true // set false for live trading
});

export async function createOrder(orderId,symbol, qty, side, ordertype) {

      // store in DB
  orderDB.push(orderId)
  console.log("updated orderBook", orderDB);

  const order = await alpaca.createOrder({
    symbol:symbol,
    qty:qty,
    side: side,
    type: ordertype,
    time_in_force: "gtc",
    client_order_id: orderId,
  });

  console.log("Order submitted:", order.id, "| clientOrderId:", orderId);

  return order.id;
}