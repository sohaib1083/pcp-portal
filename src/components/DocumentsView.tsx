"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Col, Empty, Row, Select, Space, Table, Tree, Typography, Upload } from "antd";
import { DownloadOutlined, FilePdfOutlined, FolderOutlined, UploadOutlined } from "@ant-design/icons";
import { PageTitle, Pill, fmtDate } from "./common";

export type DocRow = {
  id: number;
  folder: string;
  docType: string;
  fileName: string;
  version: number;
  sizeBytes: number;
  sha256: string;
  verificationStatus: string;
  uploadedBy: string;
  uploadedAt: string;
};

type TreeNode = { title: string; key: string; children: TreeNode[]; isLeaf?: boolean };

const LABELS: Record<string, string> = {
  "legal-documents": "Legal Documents",
  "university-documents": "University Documents",
  "noc-applications": "NOC Applications",
  accreditation: "Accreditation",
  "inspection-reports": "Inspection Reports",
  "faculty-documents": "Faculty Documents",
  "student-documents": "Student Documents",
  correspondence: "Correspondence",
};

function buildTree(root: string, folders: string[], defaults: string[]): TreeNode[] {
  const top: TreeNode = { title: root, key: "", children: [] };
  const ensure = (path: string) => {
    let node = top;
    let acc = "";
    for (const part of path.split("/")) {
      acc = acc ? `${acc}/${part}` : part;
      let child = node.children.find((c) => c.key === acc);
      if (!child) {
        child = { title: LABELS[part] ?? part, key: acc, children: [] };
        node.children.push(child);
      }
      node = child;
    }
  };
  defaults.forEach(ensure);
  folders.forEach(ensure);
  return [top];
}

export default function DocumentsView(props: {
  title: string;
  sub: string;
  root: string;
  docs: DocRow[];
  defaults: string[];
  uploadable: boolean;
  institutions?: { code: string; name: string }[];
  selectedInstitution?: string;
  onVerify?: (id: number, status: "VERIFIED" | "REJECTED") => Promise<{ ok: boolean; message: string }>;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const [folder, setFolder] = useState("");
  const [pending, start] = useTransition();
  const tree = useMemo(() => buildTree(props.root, [...new Set(props.docs.map((d) => d.folder))], props.defaults), [props.docs, props.defaults, props.root]);
  const shown = props.docs.filter((d) => folder === "" || d.folder === folder || d.folder.startsWith(folder + "/"));
  const topFolder = folder.split("/")[0];

  return (
    <>
      <PageTitle
        eyebrow="Document management"
        title={props.title}
        sub={props.sub}
        extra={
          props.institutions ? (
            <Select
              showSearch
              style={{ width: 360 }}
              value={props.selectedInstitution}
              optionFilterProp="label"
              options={props.institutions.map((i) => ({ value: i.code, label: `${i.code} · ${i.name}` }))}
              onChange={(v) => router.push(`?inst=${v}`)}
            />
          ) : null
        }
      />
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Card title="Folders">
            <Tree.DirectoryTree
              defaultExpandAll
              icon={<FolderOutlined />}
              selectedKeys={[folder]}
              treeData={tree}
              onSelect={(keys) => setFolder(String(keys[0] ?? ""))}
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              One folder per institution, following PCP&apos;s draft. Files are stored under{" "}
              <span className="mono">institutions/{props.root}/…</span> on PCP&apos;s server; downloads are permission-checked and logged.
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card
            styles={{ body: { padding: shown.length ? 0 : undefined } }}
            title={folder ? folder.split("/").map((p) => LABELS[p] ?? p).join(" / ") : "All documents"}
            extra={
              props.uploadable && topFolder && !["noc-applications", "accreditation", "inspection-reports"].includes(topFolder) ? (
                <Upload
                  showUploadList={false}
                  customRequest={async ({ file, onSuccess }) => {
                    const fd = new FormData();
                    fd.append("file", file as File);
                    fd.append("docType", LABELS[topFolder] ?? "Document");
                    fd.append("folder", folder);
                    const res = await fetch("/api/documents", { method: "POST", body: fd });
                    const j = await res.json();
                    if (res.ok) {
                      message.success(`Uploaded v${j.version}`);
                      onSuccess?.(j);
                      router.refresh();
                    } else message.error(j.error);
                  }}
                >
                  <Button size="small" icon={<UploadOutlined />}>Upload here</Button>
                </Upload>
              ) : null
            }
          >
            {shown.length === 0 ? (
              <Empty description="No documents in this folder" />
            ) : (
              <Table
                rowKey="id"
                dataSource={shown}
                pagination={{ pageSize: 12 }}
                columns={[
                  { title: "File", dataIndex: "fileName", render: (v, r) => <a href={`/api/documents/${r.id}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><FilePdfOutlined style={{ color: "#b4141f", fontSize: 16 }} /><span>{v}<div className="faint" style={{ fontSize: 11.5 }}><DownloadOutlined /> v{r.version} · {(r.sizeBytes / 1024).toFixed(0)} KB</div></span></a> },
                  { title: "Type", dataIndex: "docType" },
                  { title: "Folder", dataIndex: "folder", render: (v) => <span className="mono" style={{ fontSize: 11 }}>{v}</span> },
                  { title: "SHA-256", dataIndex: "sha256", render: (v) => <Typography.Text className="mono" copyable={{ text: v }}>{v.slice(0, 8)}…</Typography.Text> },
                  { title: "Status", dataIndex: "verificationStatus", render: (v) => <Pill value={v} /> },
                  { title: "Uploaded", render: (_, r) => <span style={{ fontSize: 12 }}>{r.uploadedBy}<br />{fmtDate(r.uploadedAt)}</span> },
                  ...(props.onVerify
                    ? [
                        {
                          title: "",
                          render: (_: unknown, r: DocRow) =>
                            r.verificationStatus === "PENDING" ? (
                              <Space size={4}>
                                <Button size="small" loading={pending} onClick={() => start(async () => { const x = await props.onVerify!(r.id, "VERIFIED"); message[x.ok ? "success" : "error"](x.message); router.refresh(); })}>Verify</Button>
                                <Button size="small" danger loading={pending} onClick={() => start(async () => { const x = await props.onVerify!(r.id, "REJECTED"); message[x.ok ? "success" : "error"](x.message); router.refresh(); })}>Reject</Button>
                              </Space>
                            ) : null,
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}
