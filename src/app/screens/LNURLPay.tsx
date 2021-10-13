import React, { useState, useEffect, MouseEvent } from "react";
import axios from "axios";
import browser from "webextension-polyfill";

import msg from "../../common/lib/msg";
import utils from "../../common/lib/utils";
import lnurl from "../../common/lib/lnurl";

import Button from "../components/Button";
import Input from "../components/Form/Input";
import Loading from "../components/Loading";
import PublisherCard from "../components/PublisherCard";

type Props = {
  details: {
    minSendable: number;
    maxSendable: number;
    callback: string;
    domain: string;
  };
  origin: {
    name: string;
    icon: string;
  };
};

function LNURLPay(props: Props) {
  const [details, setDetails] = useState(props.details);
  const [origin, setOrigin] = useState(props.origin);
  const [valueMSat, setValueMSat] = useState<string | number>(
    details?.minSendable || 0
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function getLightningData() {
      browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        const [currentTab] = tabs;
        browser.tabs
          .executeScript(currentTab.id, {
            code: "window.LBE_LIGHTNING_DATA;",
          })
          .then(async (data) => {
            // data is an array, see: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/executeScript#return_value
            // we execute it only in the current Tab. Thus the array has only one entry
            if (data[0]) {
              const lnData = data[0];
              const lnurlDetails = await lnurl.getDetails(lnData[0].recipient);
              setDetails(lnurlDetails);
              const origin = {
                external: true,
                name: lnData[0].name,
                description: lnData[0].description,
                icon: lnData[0].icon,
              };
              setOrigin(origin);
            }
          });
      });
    }

    if (!details && !origin) {
      getLightningData();
    }
  }, []);

  async function confirm() {
    try {
      setLoading(true);
      // Get the invoice
      const params = {
        amount: valueMSat, // user specified sum in MilliSatoshi
        // nonce: "", // an optional parameter used to prevent server response caching
        // fromnodes: "", // an optional parameter with value set to comma separated nodeIds if payer wishes a service to provide payment routes starting from specified LN nodeIds
        // comment: "", // an optional parameter to pass the LN WALLET user's comment to LN SERVICE. Note on comment length: GET URL's accept around ~2000 characters for the entire request string. Therefore comment can only be as large as to fit in the URL alongisde any/all of the properties outlined above.*
        // proofofpayer: "", // an optional ephemeral secp256k1 public key generated by payer, a corresponding private key should be retained by payer, a payee may later ask payer to provide a public key itself or sign a random message using corresponding private key and thus provide a proof of payer.
      };
      const { data: paymentInfo } = await axios.get(details.callback, {
        params,
      });
      const { pr: paymentRequest, successAction } = paymentInfo;

      const isValidInvoice = lnurl.verifyInvoice({
        paymentInfo,
        metadata: details.metadata,
        amount: valueMSat,
      });
      if (!isValidInvoice) {
        alert("Payment aborted. Invalid invoice");
        return;
      }

      // LN WALLET pays the invoice, no additional user confirmation is required at this point
      const payment = await utils.call("lnurlPay", {
        message: { origin },
        paymentRequest,
      });

      // Once payment is fulfilled LN WALLET executes a non-null successAction
      // LN WALLET should also store successAction data on the transaction record
      if (successAction && !payment.payment_error) {
        switch (successAction.tag) {
          case "url": // TODO: For url, the wallet should give the user a popup which displays description, url, and a 'open' button to open the url in a new browser tab
            alert(successAction.description);
            if (
              window.confirm(
                `${successAction.description} Do you want to open: ${successAction.url}?`
              )
            ) {
              window.open(successAction.url);
            }
            break;
          case "message":
            utils.notify({
              title: `LNURL response:`,
              message: successAction.message,
            });
            break;
          case "aes": // TODO: For aes, LN WALLET must attempt to decrypt a ciphertext with payment preimage
          default:
            alert(
              `Not implemented yet. Please submit an issue to support success action: ${successAction.tag}`
            );
            break;
        }
      }

      window.close();
    } catch (e) {
      console.log(e);
      alert(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  function reject(e: MouseEvent) {
    e.preventDefault();
    msg.error("User rejected");
  }

  function renderAmount() {
    if (details.minSendable === details.maxSendable) {
      return <p>{`${details.minSendable / 1000} Satoshi`}</p>;
    } else {
      return (
        <div className="mt-1 flex flex-col">
          <Input
            type="number"
            min={details.minSendable / 1000}
            max={details.maxSendable / 1000}
            value={valueMSat / 1000}
            onChange={(e) => setValueMSat(e.target.value * 1000)}
          />
          <input
            className="mt-2"
            type="range"
            min={details.minSendable}
            max={details.maxSendable}
            step="1000"
            value={valueMSat}
            onChange={(e) => setValueMSat(e.target.value)}
          />
        </div>
      );
    }
  }

  if (!details || !origin) {
    return (
      <div className="flex justify-center items-center">
        <Loading />
      </div>
    );
  }

  return (
    <div>
      <PublisherCard title={origin.name} image={origin.icon} />
      <div className="p-6">
        <dl className="shadow bg-white p-4 rounded-lg mb-8">
          <dt className="font-semibold text-gray-500">Send payment to</dt>
          <dd className="mb-6">{details.domain}</dd>
          <dt className="font-semibold text-gray-500">Amount (Satoshi)</dt>
          <dd>{renderAmount()}</dd>
        </dl>
        <div className="text-center">
          <div className="mb-5">
            <Button
              onClick={confirm}
              label="Confirm"
              fullWidth
              primary
              loading={loading}
            />
          </div>

          <p className="mb-3 underline text-sm text-gray-300">
            Only connect with sites you trust.
          </p>

          <a
            className="underline text-sm text-gray-500"
            href="#"
            onClick={reject}
          >
            Cancel
          </a>
        </div>
      </div>
    </div>
  );
}

export default LNURLPay;
