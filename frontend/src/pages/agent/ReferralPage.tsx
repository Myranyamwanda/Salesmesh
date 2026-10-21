import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ContentCopy from "@mui/icons-material/ContentCopy";
import Download from "@mui/icons-material/Download";
import EmailOutlined from "@mui/icons-material/EmailOutlined";
import PersonAddAlt from "@mui/icons-material/PersonAddAlt";
import QrCode2 from "@mui/icons-material/QrCode2";
import Sms from "@mui/icons-material/SmsOutlined";
import WhatsApp from "@mui/icons-material/WhatsApp";
import { useQuery } from "@tanstack/react-query";
import { QRCodeCanvas } from "qrcode.react";
import { Link } from "react-router-dom";
import * as portalApi from "../../api/portal";
import { PageError, PageHeader } from "../../components/DataComponents";
import type { Referral } from "../../types/scoring";

/** The share message and links. All sharing happens on the agent's device. */
function shareLinks(referral: Referral) {
  const message = `Register with ${referral.display_name} on SalesMesh: ${referral.link}`;
  const encoded = encodeURIComponent(message);
  return {
    whatsapp: `https://wa.me/?text=${encoded}`,
    // "sms:?&body=" works on both Android and iOS.
    sms: `sms:?&body=${encoded}`,
    email: `mailto:?subject=${encodeURIComponent("Your SalesMesh registration link")}&body=${encoded}`,
  };
}

function downloadCanvas(canvas: HTMLCanvasElement, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = canvas.toDataURL("image/png");
  anchor.download = fileName;
  anchor.click();
}

export function ReferralCard({ referral }: { referral: Referral }) {
  const qrRef = useRef<HTMLCanvasElement>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const links = shareLinks(referral);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referral.link);
      setNotice("Link copied.");
    } catch {
      setNotice("Copying is not available here. Select the link to copy it.");
    }
  }

  return (
    <Paper className="chart-card" variant="outlined" square>
      <Stack spacing={2}>
        <div>
          <Typography component="h2" variant="h6">
            Your registration link
          </Typography>
          <Typography color="text.secondary">
            Customers open this link on their own phone or computer to register
            with you. Your code is {referral.referral_code}.
          </Typography>
        </div>
        <Typography className="referral-link" data-testid="referral-link">
          {referral.link}
        </Typography>
        <div className="share-actions">
          <Button
            variant="contained"
            startIcon={<ContentCopy />}
            onClick={copyLink}
          >
            Copy link
          </Button>
          <Button
            variant="outlined"
            startIcon={<WhatsApp />}
            href={links.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
          >
            Share on WhatsApp
          </Button>
          <Button variant="outlined" startIcon={<Sms />} href={links.sms}>
            Send by SMS
          </Button>
          <Button
            variant="outlined"
            startIcon={<EmailOutlined />}
            href={links.email}
          >
            Send by email
          </Button>
          <Button
            variant="outlined"
            startIcon={<QrCode2 />}
            onClick={() => setQrOpen(true)}
          >
            Show QR code
          </Button>
          <Button
            variant="outlined"
            startIcon={<Download />}
            onClick={() =>
              qrRef.current &&
              downloadCanvas(
                qrRef.current,
                `salesmesh-${referral.referral_code}.png`,
              )
            }
          >
            Download QR as PNG
          </Button>
          <Button
            variant="text"
            startIcon={<PersonAddAlt />}
            component={Link}
            to={`/join/${referral.referral_code}`}
          >
            Register a customer on this device
          </Button>
        </div>
        {notice && (
          <Alert severity="info" onClose={() => setNotice("")}>
            {notice}
          </Alert>
        )}
        {/* Rendered at full size for the PNG download, shown small here. */}
        <QRCodeCanvas
          ref={qrRef}
          value={referral.link}
          size={512}
          marginSize={2}
          style={{ width: 160, height: 160 }}
          aria-label="QR code for your registration link"
        />
      </Stack>
      <Dialog open={qrOpen} onClose={() => setQrOpen(false)} maxWidth="sm">
        <DialogTitle>Scan to register with {referral.display_name}</DialogTitle>
        <DialogContent className="qr-large">
          <QRCodeCanvas
            value={referral.link}
            size={512}
            marginSize={2}
            aria-label="Large QR code for your registration link"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQrOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

export function ReferralPage() {
  const referralQuery = useQuery({
    queryKey: ["me", "referral"],
    queryFn: portalApi.getMyReferral,
  });
  return (
    <>
      <PageHeader
        eyebrow="AGENT WORKSPACE"
        title="Referral link"
        description="Share your link so customers can register with you."
      />
      {referralQuery.isError && (
        <PageError message="Your referral link could not be loaded." />
      )}
      {referralQuery.data && <ReferralCard referral={referralQuery.data} />}
    </>
  );
}
