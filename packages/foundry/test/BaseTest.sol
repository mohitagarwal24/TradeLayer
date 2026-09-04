import {TradeLayer} from "../contracts/TradeLayer.sol";
import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";

contract BaseTest is Test{
    TradeLayer trader;
    function setUp() external{
        trader = new TradeLayer(address(1), address(2));
    }
    
    function testHealth() public{
        console.log(address(trader));
    }
}