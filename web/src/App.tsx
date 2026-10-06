import { useCallback, useState } from "react";
import { Shell, type ViewId } from "./components/Shell.js";
import { Snackbar } from "./components/Feedback.js";
import { DashboardView } from "./views/DashboardView.js";
import { UploadView } from "./views/UploadView.js";
import { ReadView } from "./views/ReadView.js";
import { AuditView } from "./views/AuditView.js";

/**
 * Root component. Holds only what genuinely spans views: the active destination,
 * the blob names uploaded during this session, and the current snackbar message.
 * Everything else belongs to the view that owns it.
 */
export function App() {
    const [view, setView] = useState<ViewId>("dashboard");
    const [selectedBlob, setSelectedBlob] = useState<string | undefined>(undefined);
    const [uploadedBlobNames, setUploadedBlobNames] = useState<string[]>([]);
    const [notice, setNotice] = useState<string | null>(null);

    const notify = useCallback((message: string) => setNotice(message), []);
    const dismiss = useCallback(() => setNotice(null), []);

    const navigateToReadWithBlob = useCallback((blobName?: string) => {
        if (blobName) {
            setSelectedBlob(blobName);
        }
        setView("read");
    }, []);

    return (
        <Shell activeView={view} onNavigate={setView}>
            {view === "dashboard" && (
                <DashboardView
                    onNavigateToRead={navigateToReadWithBlob}
                    onNotify={notify}
                />
            )}
            {view === "upload" && (
                <UploadView
                    onUploaded={(entry) =>
                        // Re-uploading the same name should not add a duplicate chip.
                        setUploadedBlobNames((current) =>
                            current.includes(entry.blobName)
                                ? current
                                : [...current, entry.blobName],
                        )
                    }
                    onNotify={notify}
                />
            )}
            {view === "read" && (
                <ReadView
                    knownBlobNames={uploadedBlobNames}
                    initialBlobName={selectedBlob}
                    onNotify={notify}
                />
            )}
            {view === "audit" && <AuditView onNotify={notify} />}
            {notice && <Snackbar message={notice} onDismiss={dismiss} />}
        </Shell>
    );
}
