import { contract } from "./contract";

export async function readUserHoldings(USER) {
    console.log(`📍 Fetching holdings for: ${USER}`);
  
    // 1️⃣ Read all stock tickers owned by user
    const symbols = await contract.stockHoldings(USER);
  
    if (symbols.length === 0) {
      console.log("⚠️ User owns no stocks.\n");
      return;
    }
  
    console.log(`🧾 Stocks owned: ${symbols.join(", ")}`);
  
    const result:object[] = [];
  
    // 2️⃣ For each stock, fetch qty from mapping
    for (const ticker of symbols) {
      const qty = await contract.totalHoldings(USER, ticker);
      result.push({ stock: ticker, quantity: qty.toString() });
    }
  
    console.log("\n📊 Final portfolio:");
    console.table(result);

    return result;
  }

