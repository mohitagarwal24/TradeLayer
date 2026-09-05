import Alpaca from "@alpacahq/alpaca-trade-api";
import { v4 as uuidv4 } from "uuid";

const alpaca = new Alpaca({
  keyId: "REDACTED_ALPACA_KEY_ID",
  secretKey: "REDACTED_ALPACA_SECRET",
  paper: true // set false for live trading
});

async function orderget(){
  const {order} = await alpaca.getOrderByClientId("b3ea0016-132d-4f95-aaee-a1e5c9d2bf39");

  console.log(order);
} 


(async () => {

  await orderget();

})();