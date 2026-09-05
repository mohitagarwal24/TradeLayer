import { alpaca } from "./components/alpacaClient";

async function orderget(){
  const {order} = await alpaca.getOrderByClientId("b3ea0016-132d-4f95-aaee-a1e5c9d2bf39");

  console.log(order);
} 


(async () => {

  await orderget();

})();
