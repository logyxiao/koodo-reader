import React from "react";
import "./sidebar.css";
import { sideMenu } from "../../constants/sideMenu";
import { SidebarProps, SidebarState } from "./interface";
import { withRouter } from "react-router-dom";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { getWebsiteUrl, openInBrowser } from "../../utils/common";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import ShelfUtil, { SHELVES_CHANGED } from "../../utils/reader/shelfUtil";
import {
  addBooksToFavorite,
  addBooksToShelf,
  isBookDragEvent,
  moveBooksToTrash,
  parseBookDragData,
} from "../../utils/reader/bookDrag";
class Sidebar extends React.Component<SidebarProps, SidebarState> {
  private newShelfInput = React.createRef<HTMLInputElement>();
  constructor(props: SidebarProps) {
    super(props);
    this.state = {
      mode: "home",
      hoverMode: "",
      hoverShelfTitle: "",
      isCollpaseShelf: false,
      isOpenDelete: false,
      shelfTitle: "",
      isCollapsed:
        ConfigService.getReaderConfig("isCollapsed") === "yes" || false,
      isCreateShelf: false,
      newShelfName: "",
      dropTargetShelf: "",
      newShelfParent: "",
      collapsedShelves:
        ConfigService.getAllListConfig("collapsedShelves") || [],
    };
  }
  componentDidMount() {
    this.props.handleMode(
      document.URL.split("/").reverse()[0] === "empty"
        ? "home"
        : document.URL.split("/").reverse()[0]
    );
    document.addEventListener("dragend", this.handleDocumentDragEnd);
    window.addEventListener(SHELVES_CHANGED, this.handleShelvesChanged);
  }
  componentWillUnmount() {
    document.removeEventListener("dragend", this.handleDocumentDragEnd);
    window.removeEventListener(SHELVES_CHANGED, this.handleShelvesChanged);
  }
  handleShelvesChanged = () => {
    this.setState({
      collapsedShelves:
        ConfigService.getAllListConfig("collapsedShelves") || [],
    });
  };
  handleDocumentDragEnd = () => {
    this.setState({ dropTargetShelf: "" });
  };
  componentDidUpdate(prevProps: SidebarProps, prevState: SidebarState) {
    // Focus the input when isCreateShelf changes from false to true
    if (
      !prevState.isCreateShelf &&
      this.state.isCreateShelf &&
      this.newShelfInput.current
    ) {
      this.newShelfInput.current.focus();
    }
    // check for isOpenSortShelfDialog update the component
    if (prevProps.isOpenSortShelfDialog !== this.props.isOpenSortShelfDialog) {
      this.setState({ isCreateShelf: false, newShelfName: "" });
    }
  }
  handleSidebar = (mode: string) => {
    this.setState({ mode: mode });
    this.props.handleSelectBook(false);
    this.props.history.push(`/manager/${mode}`);
    this.props.handleMode(mode);
    this.props.handleShelf("");
    this.props.handleSearch(false);
    this.props.handleSortDisplay(false);
  };
  handleHover = (mode: string) => {
    this.setState({ hoverMode: mode });
  };
  handleShelfHover = (hoverShelfTitle: string) => {
    this.setState({ hoverShelfTitle });
  };
  handleCollapse = (isCollapsed: boolean) => {
    this.setState({ isCollapsed });
    this.props.handleCollapse(isCollapsed);
    ConfigService.setReaderConfig("isCollapsed", isCollapsed ? "yes" : "no");
  };
  handleJump = (url: string) => {
    openInBrowser(url);
  };
  handleCreateShelf = () => {
    if (!this.state.newShelfName) {
      toast(this.props.t("Shelf Title is Empty"));
      this.setState({ isCreateShelf: false, newShelfName: "" });
      return;
    }
    try {
      ShelfUtil.create(this.state.newShelfName, this.state.newShelfParent);
      const collapsedShelves = this.state.collapsedShelves.filter(
        (key) => key !== this.state.newShelfParent
      );
      ConfigService.setAllListConfig(collapsedShelves, "collapsedShelves");
      toast.success(this.props.t("Created successfully"));
      this.setState({
        isCreateShelf: false,
        newShelfName: "",
        collapsedShelves,
      });
    } catch (error) {
      toast.error(this.props.t((error as Error).message));
    }
  };
  handleBookDrop = (shelfTitle: string, event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.setState({ dropTargetShelf: "" });
    if (!isBookDragEvent(event)) return;

    const bookKeys = parseBookDragData(event);
    if (bookKeys.length === 0) return;

    const added = addBooksToShelf(bookKeys, shelfTitle);
    if (added === 0) {
      toast(this.props.t("Duplicate book"));
      return;
    }
    toast.success(this.props.t("Addition successful"));
    this.props.handleFetchBooks();
    this.props.handleShelf(shelfTitle);
    this.props.handleMode("shelf");
    this.setState({ mode: "" });
    this.props.history.push("/manager/shelf");
  };
  handleFavoriteDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.setState({ dropTargetShelf: "" });
    if (!isBookDragEvent(event)) return;

    const bookKeys = parseBookDragData(event);
    if (bookKeys.length === 0) return;

    const added = addBooksToFavorite(bookKeys);
    if (added === 0) {
      toast(this.props.t("Duplicate book"));
      return;
    }
    toast.success(this.props.t("Addition successful"));
    this.props.handleFetchBooks();
    this.props.handleShelf("");
    this.props.handleMode("favorite");
    this.setState({ mode: "favorite" });
    this.props.history.push("/manager/favorite");
  };
  handleTrashDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.setState({ dropTargetShelf: "" });
    if (!isBookDragEvent(event)) return;

    const bookKeys = parseBookDragData(event);
    if (bookKeys.length === 0) return;

    const moved = moveBooksToTrash(bookKeys);
    if (moved === 0) {
      toast(this.props.t("Duplicate book in trash bin"));
      return;
    }
    toast.success(this.props.t("Deletion successful"));
    this.props.handleFetchBooks();
    this.props.handleShelf("");
    this.props.handleMode("trash");
    this.setState({ mode: "trash" });
    this.props.history.push("/manager/trash");
  };
  getBookDragHandlers = (
    targetId: string,
    onDrop: (event: React.DragEvent) => void
  ) => ({
    onDragEnter: (event: React.DragEvent) => {
      if (isBookDragEvent(event)) {
        event.preventDefault();
        this.setState({ dropTargetShelf: targetId });
      }
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        this.setState({ dropTargetShelf: "" });
      }
    },
    onDragOver: (event: React.DragEvent) => {
      if (isBookDragEvent(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    },
    onDrop,
  });
  isBookDropTarget = (mode: string) => mode === "favorite" || mode === "trash";
  render() {
    const renderSideMenu = () => {
      return sideMenu.map((item) => {
        const isDropTarget = this.isBookDropTarget(item.mode);
        return (
          <li
            key={item.name}
            className={
              (this.props.mode === item.mode
                ? "active side-menu-item"
                : "side-menu-item") +
              (this.state.dropTargetShelf === item.mode
                ? " shelf-drop-target"
                : "")
            }
            id={`sidebar-${item.icon}`}
            onClick={() => {
              this.handleSidebar(item.mode);
            }}
            onMouseEnter={() => {
              this.handleHover(item.mode);
            }}
            onMouseLeave={() => {
              this.handleHover("");
            }}
            style={this.props.isCollapsed ? { width: 40, marginLeft: 15 } : {}}
            {...(isDropTarget
              ? this.getBookDragHandlers(
                  item.mode,
                  item.mode === "favorite"
                    ? this.handleFavoriteDrop
                    : this.handleTrashDrop
                )
              : {})}
          >
            {this.props.mode === item.mode ? (
              <div className="side-menu-selector-container"></div>
            ) : null}
            {this.state.hoverMode === item.mode ? (
              <div className="side-menu-hover-container"></div>
            ) : null}
            <div
              className={
                this.props.mode === item.mode
                  ? "side-menu-selector active-selector"
                  : "side-menu-selector "
              }
            >
              <div
                className="side-menu-icon"
                style={this.props.isCollapsed ? {} : { marginLeft: "38px" }}
              >
                <span
                  className={
                    this.props.mode === item.mode
                      ? `icon-${item.icon}  active-icon`
                      : `icon-${item.icon}`
                  }
                  style={
                    this.props.isCollapsed
                      ? { position: "relative", marginLeft: "-9px" }
                      : {}
                  }
                ></span>
              </div>

              <span
                style={
                  this.props.isCollapsed
                    ? { display: "none", width: "70%" }
                    : { width: "60%" }
                }
              >
                {this.props.t(item.name)}
              </span>
            </div>
          </li>
        );
      });
    };
    const renderSideShelf = () => {
      const tree = ShelfUtil.getTree();
      const shelves = ShelfUtil.getAll();
      const collapsed = new Set(this.state.collapsedShelves);
      const showCount =
        ConfigService.getReaderConfig("isShowShelfBookCount") === "yes";
      return tree
        .filter(
          (node) =>
            !tree.some(
              (parent) =>
                collapsed.has(parent.key) &&
                node.key.startsWith(parent.key + "/")
            )
        )
        .map((node) => (
          <li
            key={node.key}
            title={node.key}
            className={
              "side-menu-item shelf-tree-item" +
              (this.props.shelfTitle === node.key ? " active" : "") +
              (this.state.dropTargetShelf === node.key
                ? " shelf-drop-target"
                : "")
            }
            {...this.getBookDragHandlers(node.key, (event) =>
              this.handleBookDrop(node.key, event)
            )}
          >
            <div
              className={
                "side-menu-selector" +
                (this.props.shelfTitle === node.key ? " active-selector" : "")
              }
              style={{
                paddingLeft: this.props.isCollapsed ? 20 : 22 + node.depth * 14,
                boxSizing: "border-box",
              }}
            >
              <button
                type="button"
                className="shelf-tree-toggle"
                disabled={!node.hasChildren}
                aria-label={
                  this.props.t(
                    collapsed.has(node.key) ? "Expand shelf" : "Collapse shelf"
                  ) +
                  ": " +
                  node.name
                }
                aria-expanded={
                  node.hasChildren ? !collapsed.has(node.key) : undefined
                }
                onClick={() => {
                  const next = collapsed.has(node.key)
                    ? this.state.collapsedShelves.filter(
                        (key) => key !== node.key
                      )
                    : [...this.state.collapsedShelves, node.key];
                  ConfigService.setAllListConfig(next, "collapsedShelves");
                  this.setState({ collapsedShelves: next });
                }}
              >
                {node.hasChildren ? (collapsed.has(node.key) ? "▸" : "▾") : "·"}
              </button>
              <button
                type="button"
                className="shelf-tree-link"
                onClick={() => {
                  this.props.handleShelf(node.key);
                  this.props.handleMode("shelf");
                  this.props.handleSearch(false);
                  this.props.handleSelectBook(false);
                  this.setState({ mode: "" });
                  this.props.history.push("/manager/shelf");
                }}
              >
                <span className="icon-bookshelf-line" />
                {!this.props.isCollapsed && (
                  <span className="sidebar-shelf-name">{node.name}</span>
                )}
                {!this.props.isCollapsed && showCount && (
                  <span className="shelf-tree-count">
                    {ShelfUtil.bookKeys(node.key, shelves).length}
                  </span>
                )}
              </button>
              {!this.props.isCollapsed && (
                <button
                  type="button"
                  className="shelf-tree-add"
                  aria-label={this.props.t("New child shelf") + ": " + node.key}
                  title={this.props.t("New child shelf")}
                  onClick={() =>
                    this.setState({
                      isCreateShelf: true,
                      newShelfParent: node.key,
                      newShelfName: "",
                    })
                  }
                >
                  +
                </button>
              )}
            </div>
          </li>
        ));
    };
    return (
      <>
        <div className="sidebar">
          <div
            className="sidebar-list-icon"
            onClick={() => {
              this.handleCollapse(!this.state.isCollapsed);
            }}
          >
            <span className="icon-menu sidebar-list"></span>
          </div>

          <img
            src={
              ConfigService.getReaderConfig("appSkin") === "night" ||
              (ConfigService.getReaderConfig("appSkin") === "system" &&
                ConfigService.getReaderConfig("isOSNight") === "yes")
                ? require(
                    `../../assets/images/logo-dark${
                      this.props.isAuthed ? "-pro" : ""
                    }.png`
                  )
                : require(
                    `../../assets/images/logo-light${
                      this.props.isAuthed ? "-pro" : ""
                    }.png`
                  )
            }
            alt=""
            onClick={() => {
              this.handleJump(getWebsiteUrl());
            }}
            style={this.state.isCollapsed ? { display: "none" } : {}}
            className="logo"
          />
          <div
            className="side-menu-container-parent"
            style={this.state.isCollapsed ? { width: "70px" } : {}}
          >
            <ul className="side-menu-container">{renderSideMenu()}</ul>
            <div
              className="side-shelf-title-container"
              style={
                this.state.isCollapsed
                  ? { display: "none" }
                  : this.state.isCollpaseShelf
                    ? {}
                    : { border: "none" }
              }
            >
              <div className="side-shelf-title">
                <Trans>Shelf</Trans>
              </div>
              <span
                className="icon-dropdown side-shelf-title-icon"
                onClick={() => {
                  this.setState({
                    isCollpaseShelf: !this.state.isCollpaseShelf,
                  });
                }}
                style={
                  this.state.isCollpaseShelf
                    ? { transform: "rotate(-90deg)" }
                    : {}
                }
              ></span>
            </div>
            {this.props.isCollapsed ? null : !this.state.isCreateShelf ? (
              <div
                className={"side-menu-selector"}
                style={{ cursor: "pointer" }}
              >
                <div
                  className="side-menu-icon"
                  style={{
                    borderRadius: "5px",
                    backgroundColor: "rgba(0, 0, 0, 0.06)",
                    padding: "4px 0px",
                    width: "24px",
                    height: "14px",
                    marginLeft: "20px",
                    marginRight: "15px",
                  }}
                >
                  <span
                    className={`icon-add sidebar-shelf-icon`}
                    style={{ fontSize: "11px" }}
                  ></span>
                </div>

                <span
                  style={
                    this.props.isCollapsed
                      ? { display: "none", width: "70%" }
                      : { width: "60%" }
                  }
                  onClick={() => {
                    this.setState({
                      isCreateShelf: true,
                      newShelfParent: "",
                      newShelfName: "",
                    });
                  }}
                >
                  {this.props.t("New shelf")}
                </span>
              </div>
            ) : (
              <div className="shelf-create-form">
                <select
                  aria-label={this.props.t("Parent shelf")}
                  value={this.state.newShelfParent}
                  onChange={(event) =>
                    this.setState({ newShelfParent: event.target.value })
                  }
                >
                  <option value="">{this.props.t("Top level")}</option>
                  {ShelfUtil.getTree().map((node) => (
                    <option key={node.key} value={node.key}>
                      {node.key}
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <input
                    ref={this.newShelfInput}
                    type="text"
                    name="newShelf"
                    id="sidebar-new-shelf"
                    className="tag-list-item-new"
                    value={this.state.newShelfName}
                    placeholder={this.props.t("Shelf name")}
                    onChange={(event) => {
                      // Remove special characters from the shelf name
                      const sanitizedValue = event.target.value.replace(
                        /[\[\]{}",:\/\\|<>*?]/g,
                        ""
                      );
                      this.setState({ newShelfName: sanitizedValue });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        this.handleCreateShelf();
                      }
                    }}
                  />
                  <span
                    className={`icon-check sidebar-shelf-icon`}
                    onClick={(event) => {
                      event.stopPropagation();
                      this.handleCreateShelf();
                    }}
                    style={{
                      cursor: "pointer",
                      marginRight: "30px",
                      marginTop: "5px",
                    }}
                  ></span>
                </div>
              </div>
            )}
            {!this.props.isCollapsed && (
              <div
                className={"side-menu-selector"}
                style={{ cursor: "pointer" }}
                onClick={() => {
                  this.props.handleSortShelfDialog(true);
                }}
              >
                <div
                  className="side-menu-icon"
                  style={{
                    borderRadius: "5px",
                    backgroundColor: "rgba(0, 0, 0, 0.06)",
                    padding: "4px 0px",
                    width: "24px",
                    height: "14px",
                    marginLeft: "20px",
                    marginRight: "15px",
                  }}
                >
                  <span
                    className={`icon-edit-line sidebar-shelf-icon`}
                    style={{ fontSize: "17px" }}
                  ></span>
                </div>

                <span
                  style={
                    this.props.isCollapsed
                      ? { display: "none", width: "70%" }
                      : { width: "60%" }
                  }
                >
                  {this.props.t("Manage shelf")}
                </span>
              </div>
            )}
            {!this.state.isCollpaseShelf && (
              <ul className="side-shelf-container">{renderSideShelf()}</ul>
            )}
          </div>
          {/* Stats button at the bottom */}
          <div className="side-menu-about" style={{ paddingBottom: 8 }}>
            <div
              className={"side-menu-selector"}
              style={{ cursor: "pointer" }}
              onClick={() => {
                this.props.history.push("/stats");
              }}
            >
              <div
                className="side-menu-icon"
                style={
                  this.props.isCollapsed
                    ? {}
                    : { marginLeft: "20px", marginRight: "15px" }
                }
              >
                <span
                  className="icon-chart sidebar-shelf-icon"
                  style={
                    this.props.isCollapsed
                      ? {
                          position: "relative",
                          marginLeft: "-0px",
                          fontSize: 14,
                        }
                      : { fontSize: 14 }
                  }
                ></span>
              </div>
              <span
                style={
                  this.props.isCollapsed
                    ? { display: "none", width: "70%" }
                    : { width: "61%" }
                }
              >
                {this.props.t("Reading Stats")}
              </span>
            </div>
          </div>
        </div>
      </>
    );
  }
}

export default withRouter(Sidebar as any);
